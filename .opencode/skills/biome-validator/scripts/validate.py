#!/usr/bin/env python3
"""
Biome 2.3+ Validator

Validates Biome configuration and detects outdated patterns.
Ensures proper schema version, domains, assists, and recommended rules.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import NamedTuple


class Issue(NamedTuple):
    severity: str
    file: str
    line: int | None
    message: str
    fix: str | None


class ValidationResult:
    def __init__(self):
        self.issues: list[Issue] = []
        self.passed: list[str] = []
        self.biome_version: str | None = None
        self.schema_version: str | None = None

    def add_issue(self, severity: str, file: str, message: str, line: int | None = None, fix: str | None = None):
        self.issues.append(Issue(severity, file, line, message, fix))

    def add_passed(self, message: str):
        self.passed.append(message)

    @property
    def has_errors(self) -> bool:
        return any(i.severity == 'error' for i in self.issues)


def check_package_version(root: Path, result: ValidationResult) -> bool:
    """Check if Biome 2.3+ is installed."""
    pkg_path = root / 'package.json'
    if not pkg_path.exists():
        result.add_issue('error', 'package.json', 'package.json not found')
        return False

    try:
        with open(pkg_path) as f:
            pkg = json.load(f)
    except json.JSONDecodeError:
        result.add_issue('error', 'package.json', 'Invalid JSON')
        return False

    deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}

    if '@biomejs/biome' not in deps:
        result.add_issue('error', 'package.json',
                        '@biomejs/biome not found in dependencies',
                        fix='bun add -D @biomejs/biome@latest')
        return False

    version = deps['@biomejs/biome']
    result.biome_version = version

    # Parse version
    match = re.search(r'(\d+)\.(\d+)', version)
    if match:
        major, minor = int(match.group(1)), int(match.group(2))
        if major < 2:
            result.add_issue('error', 'package.json',
                           f'Biome 1.x detected ({version}). Must use v2.3+',
                           fix='bun add -D @biomejs/biome@latest')
            return False
        if major == 2 and minor < 3:
            result.add_issue('warning', 'package.json',
                           f'Biome {version} detected. Consider upgrading to 2.3+',
                           fix='bun add -D @biomejs/biome@latest')
        else:
            result.add_passed(f'Biome version: {version}')
        return True

    result.add_issue('warning', 'package.json', f'Could not parse Biome version: {version}')
    return True


def check_biome_config(root: Path, result: ValidationResult) -> dict | None:
    """Check biome.json configuration."""
    config_path = root / 'biome.json'
    if not config_path.exists():
        config_path = root / 'biome.jsonc'

    if not config_path.exists():
        result.add_issue('error', 'biome.json', 'biome.json not found',
                        fix='bunx biome init')
        return None

    try:
        with open(config_path) as f:
            content = f.read()
            # Remove comments for jsonc
            content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
            config = json.loads(content)
    except json.JSONDecodeError as e:
        result.add_issue('error', config_path.name, f'Invalid JSON: {e}')
        return None

    return config


def check_schema_version(config: dict, result: ValidationResult):
    """Check $schema version."""
    schema = config.get('$schema', '')

    if not schema:
        result.add_issue('warning', 'biome.json',
                        'No $schema defined',
                        fix='Add "$schema": "https://biomejs.dev/schemas/2.3.11/schema.json"')
        return

    # Extract version from schema URL
    match = re.search(r'/schemas/(\d+\.\d+\.\d+)/', schema)
    if match:
        version = match.group(1)
        result.schema_version = version

        parts = version.split('.')
        major, minor = int(parts[0]), int(parts[1])

        if major < 2:
            result.add_issue('error', 'biome.json',
                           f'Schema version {version} is outdated. Use 2.3+',
                           fix='Update $schema to "https://biomejs.dev/schemas/2.3.11/schema.json"')
        elif major == 2 and minor < 3:
            result.add_issue('warning', 'biome.json',
                           f'Schema version {version}. Consider upgrading to 2.3+',
                           fix='Update $schema to "https://biomejs.dev/schemas/2.3.11/schema.json"')
        else:
            result.add_passed(f'Schema version: {version}')
    else:
        result.add_issue('warning', 'biome.json',
                        f'Could not parse schema version from: {schema}')


def check_linter_config(config: dict, result: ValidationResult):
    """Check linter configuration."""
    linter = config.get('linter', {})

    if not linter.get('enabled', True):
        result.add_issue('warning', 'biome.json',
                        'Linter is disabled',
                        fix='Set linter.enabled: true')
        return

    result.add_passed('Linter enabled')

    # Check rules
    rules = linter.get('rules', {})
    if rules.get('recommended'):
        result.add_passed('Using recommended rules')
    else:
        result.add_issue('warning', 'biome.json',
                        'Recommended rules not enabled',
                        fix='Add "recommended": true to linter.rules')

    # Check for useful rules
    correctness = rules.get('correctness', {})
    if correctness.get('useAwaitThenable'):
        result.add_passed('useAwaitThenable rule enabled')
    else:
        result.add_issue('warning', 'biome.json',
                        'useAwaitThenable not enabled (catches await on non-Promise)',
                        fix='Add correctness.useAwaitThenable: "error"')

    if correctness.get('noLeakedRender'):
        result.add_passed('noLeakedRender rule enabled')

    # Check domains (Biome 2.0+)
    domains = linter.get('domains', {})
    if domains:
        enabled_domains = [k for k, v in domains.items() if v == 'on']
        if enabled_domains:
            result.add_passed(f'Domains enabled: {", ".join(enabled_domains)}')
    else:
        result.add_issue('warning', 'biome.json',
                        'No domains configured (consider enabling react, next, test)',
                        fix='Add linter.domains: { "react": "on", "next": "on" }')


def check_assist_config(config: dict, result: ValidationResult):
    """Check assist configuration (Biome 2.0+)."""
    assist = config.get('assist', {})

    # Check for old organizeImports location
    if 'organizeImports' in config:
        result.add_issue('error', 'biome.json',
                        'organizeImports at root level is deprecated',
                        fix='Move to assist.actions.source.organizeImports')
        return

    actions = assist.get('actions', {})
    source = actions.get('source', {})

    if source.get('organizeImports') == 'on':
        result.add_passed('Using assist.actions for import organization')
    else:
        result.add_issue('warning', 'biome.json',
                        'Import organization not configured',
                        fix='Add assist.actions.source.organizeImports: "on"')


def check_formatter_config(config: dict, result: ValidationResult):
    """Check formatter configuration."""
    formatter = config.get('formatter', {})

    if not formatter.get('enabled', True):
        result.add_issue('warning', 'biome.json',
                        'Formatter is disabled',
                        fix='Set formatter.enabled: true')
        return

    result.add_passed('Formatter enabled')

    # Check basic settings
    if formatter.get('indentStyle'):
        result.add_passed(f'Indent style: {formatter["indentStyle"]}')


def check_old_configs(root: Path, result: ValidationResult):
    """Check for old ESLint/Prettier configs that should be removed."""
    old_files = [
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.json',
        '.eslintrc.yml',
        '.eslintrc.yaml',
        '.prettierrc',
        '.prettierrc.js',
        '.prettierrc.json',
        '.prettierrc.yml',
        '.prettierrc.yaml',
        'prettier.config.js',
        '.eslintignore',
        '.prettierignore',
    ]

    for old_file in old_files:
        if (root / old_file).exists():
            result.add_issue('warning', old_file,
                           f'Old config file found - Biome replaces ESLint/Prettier',
                           fix=f'rm {old_file}')


def print_report(result: ValidationResult, verbose: bool = False):
    """Print validation report."""
    print("\n" + "=" * 50)
    print("  Biome 2.3+ Validation Report")
    print("=" * 50 + "\n")

    if result.biome_version:
        print(f"Package Version: @biomejs/biome@{result.biome_version.lstrip('^~>=')}")
    if result.schema_version:
        print(f"Schema Version: {result.schema_version}")
    print()

    if verbose and result.passed:
        print("Passed Checks:")
        for msg in result.passed:
            print(f"  [PASS] {msg}")
        print()

    if result.issues:
        errors = [i for i in result.issues if i.severity == 'error']
        warnings = [i for i in result.issues if i.severity == 'warning']

        if errors:
            print("Errors:")
            for issue in errors:
                print(f"  [ERROR] {issue.file}")
                print(f"          {issue.message}")
                if issue.fix:
                    print(f"          Fix: {issue.fix}")
            print()

        if warnings:
            print("Warnings:")
            for issue in warnings:
                print(f"  [WARN] {issue.file}")
                print(f"         {issue.message}")
                if issue.fix:
                    print(f"         Fix: {issue.fix}")
            print()

    print("-" * 50)
    error_count = len([i for i in result.issues if i.severity == 'error'])
    warning_count = len([i for i in result.issues if i.severity == 'warning'])

    if error_count == 0 and warning_count == 0:
        print("Result: All checks passed! Biome configured correctly.")
    else:
        print(f"Result: {error_count} error(s), {warning_count} warning(s)")

    print()


def main():
    parser = argparse.ArgumentParser(description='Validate Biome 2.3+ configuration')
    parser.add_argument('--root', '-r', type=str, default='.', help='Project root directory')
    parser.add_argument('--strict', action='store_true', help='Treat warnings as errors')
    parser.add_argument('--ci', action='store_true', help='CI mode: exit with non-zero on errors')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show passed checks')
    parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()
    root = Path(args.root).resolve()

    if not root.exists():
        print(f"Error: Directory not found: {root}")
        sys.exit(1)

    result = ValidationResult()

    # Run all checks
    check_package_version(root, result)
    config = check_biome_config(root, result)

    if config:
        check_schema_version(config, result)
        check_linter_config(config, result)
        check_assist_config(config, result)
        check_formatter_config(config, result)

    check_old_configs(root, result)

    # Output
    if args.json:
        output = {
            'biome_version': result.biome_version,
            'schema_version': result.schema_version,
            'passed': result.passed,
            'issues': [
                {
                    'severity': i.severity,
                    'file': i.file,
                    'message': i.message,
                    'fix': i.fix
                }
                for i in result.issues
            ]
        }
        print(json.dumps(output, indent=2))
    else:
        print_report(result, verbose=args.verbose)

    # Exit code
    if args.ci or args.strict:
        if result.has_errors:
            sys.exit(1)
        if args.strict and any(i.severity == 'warning' for i in result.issues):
            sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()
