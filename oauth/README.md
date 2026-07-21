# Google OAuth credentials

Place the downloaded Google OAuth web-client JSON at:

```text
oauth/google-web-client.json
```

The JSON files in this directory are gitignored. The root `.credentials` file selects which
file supplies each Google OAuth role:

```toml
[google]
oauth_credentials_file = "oauth/google-web-client.json"

[google_auth]
credentials_file = "oauth/google-web-client.json"
```

It is fine to point both roles at one web client initially. They can be changed to separate
files later without changing the generated environment variable names.
