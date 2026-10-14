# Changelog

## [0.8.1](https://github.com/gracefullight/stock-checker/compare/v0.8.0...v0.8.1) (2026-10-14)


### Bug Fixes

* **mcp:** hide the svg price chart through the hidden attribute ([985b186](https://github.com/gracefullight/stock-checker/commit/985b186dbf37ca2d13daa2ac20e2d87d362222e9))


### Refactoring

* **core:** drop the ignored coverageSummary alert field ([0f742d7](https://github.com/gracefullight/stock-checker/commit/0f742d7cf69f94de23405690f821dd70485435d3))


### Maintenance

* **core:** remove unused optimize prompt ([c18939f](https://github.com/gracefullight/stock-checker/commit/c18939f69b19acd006e857d5f8c5c586e1dfb226))

## [0.8.0](https://github.com/gracefullight/stock-checker/compare/v0.7.13...v0.8.0) (2026-10-13)


### Features

* **api:** support job deep links on the market-screen list ([6b1ce0b](https://github.com/gracefullight/stock-checker/commit/6b1ce0be94a7d5d532bb8557ddcffe3a006a532c))
* **core:** add configured-universe provenance to market screens ([3353844](https://github.com/gracefullight/stock-checker/commit/335384420b10607585607be4d2851a858237fb9b))
* **core:** add matched SPY benchmarks to strategy validation ([ac3a292](https://github.com/gracefullight/stock-checker/commit/ac3a2928041ea701204a3699e883ddccb90b24d8))
* **core:** add opt-in pruning for saved market scans ([c6b8075](https://github.com/gracefullight/stock-checker/commit/c6b8075fb7d761f7e76cb27f563f56c53872e727))
* **core:** add position ledger with five-session exit plan and digest ([eb0120e](https://github.com/gracefullight/stock-checker/commit/eb0120e4cf1b521745c3ee3efad88b53132fac47))
* **core:** add trade plan, cohort and heartbeat to whatsapp reports ([6676375](https://github.com/gracefullight/stock-checker/commit/6676375fd77f1e740c5672e607a1e71966c2da08))
* **core:** judge forward paper outcomes against SPY ([ef87918](https://github.com/gracefullight/stock-checker/commit/ef87918be5662229254a5ac9557333065d188696))
* **core:** scan the validated universe daily with a session gate ([62daa46](https://github.com/gracefullight/stock-checker/commit/62daa4693aa42a5e8668cc8a7cd99790896b3560))
* **core:** structured gate blockers, eligibility floors and cluster options ([d35932f](https://github.com/gracefullight/stock-checker/commit/d35932f9bf96b35c466dde2e774c5dcc572a1bc6))
* **daily-report:** append position digest and add positions task ([7af457b](https://github.com/gracefullight/stock-checker/commit/7af457b909d92c8191e03865de67028705ffbd13))
* **mcp:** add list_market_screens and get_daily_report with compact output ([2a53986](https://github.com/gracefullight/stock-checker/commit/2a539866f93973cd1c69ef5170927767db54e687))
* **web:** derive score visuals from final decision and frozen thresholds ([9b525bc](https://github.com/gracefullight/stock-checker/commit/9b525bc02a108b7e0d4483a5dca66de51adc10a6))
* **web:** korean decision reasons, validated stat and hold-window earnings warning ([d37a3ce](https://github.com/gracefullight/stock-checker/commit/d37a3cea56af9c552fb5968f23f505ac8382f56b))
* **web:** market-screen deep links, near-miss view and job lane labels ([8b5d51c](https://github.com/gracefullight/stock-checker/commit/8b5d51c32eddd8eb61e054d1a614c4ff5c8a2759))
* **web:** proxy /api same-origin and surface server error text ([a1df0ce](https://github.com/gracefullight/stock-checker/commit/a1df0ce20089e37fb7bf374a2aba4e201e5cc560))
* **web:** separate legacy and current-config chart signal markers ([9d5893b](https://github.com/gracefullight/stock-checker/commit/9d5893b296596aff2402a1acf861226155240f79))
* **whatsapp:** probe gateway, retry definite non-sends, pin recipients ([fffdc9a](https://github.com/gracefullight/stock-checker/commit/fffdc9a1b4184468984632f3e90fa657696ce908))


### Bug Fixes

* **api:** bind to loopback, restrict CORS, and guard every write ([1783c7b](https://github.com/gracefullight/stock-checker/commit/1783c7bfe14ee654a7347a8d042b2edf25738ee3))
* **api:** cap and throttle screener fan-out and report unavailable tickers ([f589e4e](https://github.com/gracefullight/stock-checker/commit/f589e4e721f95dce74f59bbf51e732a4097c4a23))
* **cli:** apply extra-data flags to all tickers, print portfolio reports, add --sort-by ([de7f9e0](https://github.com/gracefullight/stock-checker/commit/de7f9e0efdccdc1fa80a6695842866afaaec6d96))
* **core:** anchor portfolio and watchlist stores under data/ ([7a724a9](https://github.com/gracefullight/stock-checker/commit/7a724a9b85c4e248295f7403036799108536ba7f))
* **core:** fail explicit config paths with the violated validator rule ([979b893](https://github.com/gracefullight/stock-checker/commit/979b89346ff5a79688939e4838f178db29dddaf3))
* **core:** fingerprint prediction CSV rows and read only the validated strategy ([f1b6dbe](https://github.com/gracefullight/stock-checker/commit/f1b6dbe5c96d468a37c61a2b5f7c15516226f5c3))
* **core:** report real slack webhook status and drop sell levels ([5e0bacc](https://github.com/gracefullight/stock-checker/commit/5e0baccfef128a20244b05ae0eafa074a183c337))
* **core:** report unavailable benchmarks and stale sessions instead of hold ([bfdd6fe](https://github.com/gracefullight/stock-checker/commit/bfdd6feb06e286096b994a8ad34fd2e61310179f))
* **web:** never serve signal pages from the service worker cache ([b27269a](https://github.com/gracefullight/stock-checker/commit/b27269a7368fbb562dec7cd0107b506381d336f0))
* **web:** resolve core alias imports and normalize engine gate blockers ([2aded8a](https://github.com/gracefullight/stock-checker/commit/2aded8a821b84841fa68bc36368fd22521d641d7))


### Refactoring

* **core:** extract shared NYSE session calendar ([06aebe1](https://github.com/gracefullight/stock-checker/commit/06aebe1a8e8e4bb52fbd2ebf74b84234188d2ca7))
* **core:** extract shared NYSE session calendar ([ed60a4c](https://github.com/gracefullight/stock-checker/commit/ed60a4cc7ecfcea27e098f89ac954d550492f185))
* **core:** remove dead gaussian pre-pass and fix filter comments ([61273a9](https://github.com/gracefullight/stock-checker/commit/61273a93da5088d1f45e52b1407aaa782c8882ab))
* **core:** remove the optimize/learn config-overwrite path ([b75f652](https://github.com/gracefullight/stock-checker/commit/b75f652b79a2cbeb3b4476f31eb7c3b3104cbd49))
* **mcp:** move dashboard client into a type-checked js module ([d02e7ee](https://github.com/gracefullight/stock-checker/commit/d02e7ee450d932a550920387df85c1d1d1724d64))


### Documentation

* align agents, readme, and design docs with the code ([faf49c6](https://github.com/gracefullight/stock-checker/commit/faf49c687a38e19afd620fb2c42abf03dc5f2633))
* describe CLI sort-by, portfolio report, MCP discovery tools, and API hardening ([56e7598](https://github.com/gracefullight/stock-checker/commit/56e759809d6da24fa3b5bbf1bfab6e4966569a32))
* describe the validated-universe daily report and prune task ([5f8f72d](https://github.com/gracefullight/stock-checker/commit/5f8f72d814da43c63f6ba8cb160cc34b7dab34cb))
* state the leader-pullback result relative to SPY ([f41b4db](https://github.com/gracefullight/stock-checker/commit/f41b4db8e5781593f820a1a683ae7ec8653313fc))


### Tests

* align api and mcp fixtures with benchmark and daily state fields ([c1d6452](https://github.com/gracefullight/stock-checker/commit/c1d6452b2c5968fd2d9ef57966b49fc145a1ef29))
* **core:** accept collapsed price-tier causes in screen summaries ([e2102fd](https://github.com/gracefullight/stock-checker/commit/e2102fdd42695c3b62f742ce397d5baf64ad72a5))
* **core:** strip comments before scanning browser entry imports ([0912353](https://github.com/gracefullight/stock-checker/commit/0912353e8383e880977d70db5b926158e8e0e298))
* **mcp:** raise stdio timeouts and keep sibling suites running ([774ceb1](https://github.com/gracefullight/stock-checker/commit/774ceb15a0a425c28007e5751e78b0f8f3acaa5e))
* **web:** align market-screen fixtures with universe union and benchmark fields ([018e772](https://github.com/gracefullight/stock-checker/commit/018e7720b28499ed43b7083877c85b6e45a40053))


### Build System

* **finance:** scope python quality gates to packages/finance ([82e0694](https://github.com/gracefullight/stock-checker/commit/82e0694c426a5eec17585c907f5602e7cd9e8fbf))


### Continuous Integration

* **release:** exclude nightly data commits from releases ([54d18f4](https://github.com/gracefullight/stock-checker/commit/54d18f41c854b8fdf69bf8d0af8dbbe396e94e2a))


### Maintenance

* **main:** release 0.7.10 ([420c573](https://github.com/gracefullight/stock-checker/commit/420c5732c81e6e2c3bc4454798eebc697b9453b7))
* **main:** release 0.7.11 ([959921c](https://github.com/gracefullight/stock-checker/commit/959921cc688a3c808afa014abccd61464cc8cf96))
* **main:** release 0.7.12 ([548182c](https://github.com/gracefullight/stock-checker/commit/548182ccb38aee37c989fd388427e61029f7ca1d))
* **main:** release 0.7.13 ([1744d18](https://github.com/gracefullight/stock-checker/commit/1744d181c02750a4a83a027f4fbab518bc2f0672))
* **main:** release 0.7.8 ([66e185f](https://github.com/gracefullight/stock-checker/commit/66e185f1f483e07a31a930f1a13cffd9cbb96824))
* **main:** release 0.7.9 ([2fdcad4](https://github.com/gracefullight/stock-checker/commit/2fdcad42892ab9629f4326ab52adb059509305d9))
* untrack stale memories, plans, and runtime artifacts ([d8aa9da](https://github.com/gracefullight/stock-checker/commit/d8aa9da40d5486232276bba54a5a6654716e1519))

## [0.7.13](https://github.com/gracefullight/stock-checker/compare/v0.7.12...v0.7.13) (2026-10-13)


### Maintenance

* daily stock data update ([968e9e3](https://github.com/gracefullight/stock-checker/commit/968e9e362686dee6bd3f54c68477d676e1736849))

## [0.7.12](https://github.com/gracefullight/stock-checker/compare/v0.7.11...v0.7.12) (2026-10-12)


### Maintenance

* daily stock data update ([086854b](https://github.com/gracefullight/stock-checker/commit/086854b072b5babbc7c38981ac72de02f1afb625))

## [0.7.11](https://github.com/gracefullight/stock-checker/compare/v0.7.10...v0.7.11) (2026-10-11)


### Maintenance

* daily stock data update ([1670ccb](https://github.com/gracefullight/stock-checker/commit/1670ccb9c9bf2cf13fb3664b406507afa0c478e0))

## [0.7.10](https://github.com/gracefullight/stock-checker/compare/v0.7.9...v0.7.10) (2026-10-10)


### Maintenance

* daily stock data update ([b426629](https://github.com/gracefullight/stock-checker/commit/b42662964d9c76ff03206d9ec48b1323d8983fce))

## [0.7.9](https://github.com/gracefullight/stock-checker/compare/v0.7.8...v0.7.9) (2026-10-09)


### Maintenance

* daily stock data update ([9072a45](https://github.com/gracefullight/stock-checker/commit/9072a45f4f9c3749d4f8c7357085bccb019b63a0))

## [0.7.8](https://github.com/gracefullight/stock-checker/compare/v0.7.7...v0.7.8) (2026-10-09)


### Bug Fixes

* clarify whatsapp screening results and exclusions ([126a8c7](https://github.com/gracefullight/stock-checker/commit/126a8c7348f04c99fded27b81cf5a61e6855d36a))


### Maintenance

* update oma hooks and skills to 16.0.1 ([82cc3cb](https://github.com/gracefullight/stock-checker/commit/82cc3cb0109cd69ca0f1c3583af96344677dc74f))

## [0.7.7](https://github.com/gracefullight/stock-checker/compare/v0.7.6...v0.7.7) (2026-10-08)


### Maintenance

* daily stock data update ([0be49ae](https://github.com/gracefullight/stock-checker/commit/0be49ae779b41b91d87889235ae35bcb78e7b869))

## [0.7.6](https://github.com/gracefullight/stock-checker/compare/v0.7.5...v0.7.6) (2026-10-07)


### Maintenance

* daily stock data update ([59df56f](https://github.com/gracefullight/stock-checker/commit/59df56fa37385dd10a1a493e486a148ba85f505e))

## [0.7.5](https://github.com/gracefullight/stock-checker/compare/v0.7.4...v0.7.5) (2026-10-06)


### Refactoring

* migrate automation to typescript workspaces ([e1872ce](https://github.com/gracefullight/stock-checker/commit/e1872ceee658a76d7a5ca80bd11701df2daef41b))

## [0.7.4](https://github.com/gracefullight/stock-checker/compare/v0.7.3...v0.7.4) (2026-10-06)


### Maintenance

* update oma to 15.7.1 ([ade5221](https://github.com/gracefullight/stock-checker/commit/ade522149256d6d01c60aed40687c12c59c0ecbc))

## [0.7.3](https://github.com/gracefullight/stock-checker/compare/v0.7.2...v0.7.3) (2026-10-06)


### Bug Fixes

* use plain volatility wording in stock reports ([0bcfe84](https://github.com/gracefullight/stock-checker/commit/0bcfe844382ff5ac15aec19e6f5b379ffeae0d8b))

## [0.7.2](https://github.com/gracefullight/stock-checker/compare/v0.7.1...v0.7.2) (2026-10-06)


### Bug Fixes

* distinguish screening limits and unavailable analysis ([fe6401e](https://github.com/gracefullight/stock-checker/commit/fe6401e34caa504ac262040316be34868a0c4c0d))

## [0.7.1](https://github.com/gracefullight/stock-checker/compare/v0.7.0...v0.7.1) (2026-10-06)


### Bug Fixes

* preserve screening configuration in alert win rates ([a791444](https://github.com/gracefullight/stock-checker/commit/a79144436493f3d3af8f9128e44dbc61fc329c50))

## [0.7.0](https://github.com/gracefullight/stock-checker/compare/v0.6.0...v0.7.0) (2026-10-06)


### Features

* unify leader-pullback analysis and validate win rates ([7f687c9](https://github.com/gracefullight/stock-checker/commit/7f687c92e1e701f1af0d0b8c457cae627ec0f7d5))

## [0.6.0](https://github.com/gracefullight/stock-checker/compare/v0.5.3...v0.6.0) (2026-10-06)


### Features

* schedule sydney morning screening reports ([2786ad2](https://github.com/gracefullight/stock-checker/commit/2786ad232f550ae88ac2ae128d475bb48d5f5432))


### Documentation

* shorten readme to essential usage ([0a727eb](https://github.com/gracefullight/stock-checker/commit/0a727eb255cdaa35205e7f1e4c799b81a00d8000))


### Continuous Integration

* consolidate python checks into quality workflow ([e88e565](https://github.com/gracefullight/stock-checker/commit/e88e56587265463ebd518a50c21d6cdcc8de4e42))

## [0.5.3](https://github.com/gracefullight/stock-checker/compare/v0.5.2...v0.5.3) (2026-10-06)


### Maintenance

* daily stock data update ([25e07a9](https://github.com/gracefullight/stock-checker/commit/25e07a9969f31620ffd5d011b945c03f8b4efda3))

## [0.5.2](https://github.com/gracefullight/stock-checker/compare/v0.5.1...v0.5.2) (2026-10-06)


### Bug Fixes

* **whatsapp:** remove report footers ([e156e11](https://github.com/gracefullight/stock-checker/commit/e156e11f97ecf071af37bd4246f087c2158a35d3))

## [0.5.1](https://github.com/gracefullight/stock-checker/compare/v0.5.0...v0.5.1) (2026-10-06)


### Bug Fixes

* **whatsapp:** improve stock alert readability ([008bf56](https://github.com/gracefullight/stock-checker/commit/008bf562a467d11052e1e020297a3dd7852c4720))

## [0.5.0](https://github.com/gracefullight/stock-checker/compare/v0.4.1...v0.5.0) (2026-10-05)


### Features

* **whatsapp:** include historical rates and analyst targets ([d41e5f0](https://github.com/gracefullight/stock-checker/commit/d41e5f04a00148e7726487b594e8e7b7f928860d))


### Bug Fixes

* **whatsapp:** load report providers only during enrichment ([f1142a6](https://github.com/gracefullight/stock-checker/commit/f1142a6621191abec964194116aa4f8b8ae35da5))

## [0.4.1](https://github.com/gracefullight/stock-checker/compare/v0.4.0...v0.4.1) (2026-10-05)


### Bug Fixes

* **whatsapp:** repair initial companion registration ([e26dfb8](https://github.com/gracefullight/stock-checker/commit/e26dfb8e3a37ed4bf6a3a355e691c8f5bf5c21e5))

## [0.4.0](https://github.com/gracefullight/stock-checker/compare/v0.3.0...v0.4.0) (2026-10-05)


### Features

* **whatsapp:** run the gateway as a macos user service ([998f7e2](https://github.com/gracefullight/stock-checker/commit/998f7e26fbc2aaa0f1ce935a1b63a6e409a2035b))

## [0.3.0](https://github.com/gracefullight/stock-checker/compare/v0.2.2...v0.3.0) (2026-10-05)


### Features

* **whatsapp:** use a local QR-linked notification gateway ([9239426](https://github.com/gracefullight/stock-checker/commit/9239426db1117f9b9ce9c71221bd9c80f6c8cf1d))

## [0.2.2](https://github.com/gracefullight/stock-checker/compare/v0.2.1...v0.2.2) (2026-10-05)


### Bug Fixes

* **mcp:** preserve stdio input through mise ([d3f6c87](https://github.com/gracefullight/stock-checker/commit/d3f6c87ed013a9aed5d571e2428ebf8505358d19))

## [0.2.1](https://github.com/gracefullight/stock-checker/compare/v0.2.0...v0.2.1) (2026-10-05)


### Tests

* verify market-screen pacing within each worker ([d0dfc02](https://github.com/gracefullight/stock-checker/commit/d0dfc02b78c853c430ab9362ab3aabc59e090a70))

## [0.2.0](https://github.com/gracefullight/stock-checker/compare/v0.1.1...v0.2.0) (2026-10-05)


### Features

* add whatsapp stock signal and screening notifications ([be08793](https://github.com/gracefullight/stock-checker/commit/be08793ba314642c9fe7f7ea21672d0c2d03df2c))

## [0.1.1](https://github.com/gracefullight/stock-checker/compare/v0.1.0...v0.1.1) (2026-10-05)


### Bug Fixes

* wait for initial release metadata propagation ([944acb5](https://github.com/gracefullight/stock-checker/commit/944acb558d84a17a0e289f63451f5d752c688907))

## 0.1.0 (2026-10-05)


### Features

* automate main releases with release please ([23b4cfd](https://github.com/gracefullight/stock-checker/commit/23b4cfd9683db3ee7404f05564fe43975f401e1d))


### Bug Fixes

* trigger releases after automated data pushes ([1138537](https://github.com/gracefullight/stock-checker/commit/113853740d226e7bc5703adbba9a542ff63a538e))
* wait for release pull request head propagation ([0fdcc00](https://github.com/gracefullight/stock-checker/commit/0fdcc00e9fd13c31f2c6c7b8dc05ab424d8656b1))


### Maintenance

* daily stock data update ([b1ad099](https://github.com/gracefullight/stock-checker/commit/b1ad099b88f1a1f6bd88144baa09ebe9b7e40520))
