# Development

Create a virtual environment, install `requirements.txt`, then run
`pytest -q tests` before making changes. Start local development with:

```bash
uvicorn backend.main:app --reload --port 8000
```

The frontend is intentionally zero-build and is served by FastAPI. Configure
optional live-data keys in `.env`; use `CORS_ORIGINS` only when the frontend is
hosted on a different origin. Model retraining is disabled by default and must
be run through an administrator-controlled job with the environment variables
documented in `.env.example`.
