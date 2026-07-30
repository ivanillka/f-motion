# Contributing

F-Engine is not accepting outside code contributions initially. Please do not
open pull requests: they will be closed without merging. Focused bug reports
that contain no confidential information are welcome.

Maintainer changes use Node 24.15.0 and npm 11.12.1:

```sh
npm ci
npm run lint
npm test
npm run build
```

Changes stay narrow, include a runnable regression for non-trivial behavior,
and preserve host neutrality. All distributed project code is licensed under
Apache-2.0. Opening contributions later requires an explicit inbound-licensing
and governance decision.
