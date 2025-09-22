# Deployment notes

## Environment configuration

- `CORS_ALLOW_ORIGINS` (optional): Comma-separated allow-list of origins that may call the API. Example: `https://burak.wtf,http://localhost:4173,null`.
  - Use `null` to allow `file://` origins.
  - Falls back to the legacy `CORS_ALLOW_ORIGIN` variable or the production default when unset.
