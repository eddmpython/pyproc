# Python SDK product gate

This lane builds both Python distribution formats, installs each into a separate clean virtual environment,
and runs the installed SDK against the packed npm product. The full journey covers preflight, persistent
Python, checkpoint restore, cancellation, permission denial, a real browser target, and a verified PNG
attachment. The source distribution environment runs codec and metadata negative fixtures.

```sh
npm run test:python-sdk
```
