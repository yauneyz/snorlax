# Browser Extension Hosting Plan

FocusLock should distribute the browser extension the same way the owl site distributes desktop
release artifacts: the web app owns the public URLs and release metadata, while S3 stores the large
immutable files. Users and browser policies should point at `https://focuslock.app/ext/...`, not at
machine-local files or unpacked extension builds.

## Target Shape

S3 is the artifact store:

```text
s3://focuslock-extension-artifacts-prod/ext/chromium/focuslock-0.1.0.crx
s3://focuslock-extension-artifacts-prod/ext/chromium/updates.xml
s3://focuslock-extension-artifacts-prod/ext/firefox/focuslock-0.1.0.xpi
s3://focuslock-extension-artifacts-prod/ext/firefox/updates.json
```

The Snorlax web app is the public control plane:

```text
https://focuslock.app/ext/chromium/updates.xml
https://focuslock.app/ext/chromium/focuslock-0.1.0.crx
https://focuslock.app/ext/firefox/updates.json
https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi
```

The web app should follow the owl pattern:

- fetch release metadata from S3 as the source of truth;
- serve small metadata files from app routes with the correct content type;
- redirect large binary artifact requests to S3, or proxy them only if redirect behavior fails in a
  supported browser;
- optionally record download/update-check telemetry in the app before returning the response.

## Proposed Names

Create these AWS resources unless they already exist:

```text
bucket: focuslock-extension-artifacts-prod
region: us-east-1
public base URL: https://focuslock-extension-artifacts-prod.s3.us-east-1.amazonaws.com
app route base URL: https://focuslock.app/ext
```

Use a separate dev bucket only if we need browser-policy testing that must not touch prod:

```text
bucket: focuslock-extension-artifacts-dev
region: us-east-1
app route base URL: https://dev.focuslock.app/ext
```

## `.credentials` Config

All config should live in `.credentials`, with `.credentials.example` documenting the fields. Add
these sections:

```toml
[aws]
region = "us-east-1"
access_key_id = "AKIA..."
secret_access_key = "..."

[extension_hosting]
bucket = "focuslock-extension-artifacts-prod"
public_s3_base_url = "https://focuslock-extension-artifacts-prod.s3.us-east-1.amazonaws.com"
public_app_base_url = "https://focuslock.app/ext"
chromium_update_url = "https://focuslock.app/ext/chromium/updates.xml"
firefox_update_url = "https://focuslock.app/ext/firefox/updates.json"
firefox_xpi_url = "https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi"

[extension_signing.chromium]
# Store the private key outside git. The release script can read from this path locally,
# or CI can materialize it from a secret before running.
private_key_path = "apps/extension/keys/chromium.pem"
expected_extension_id = "cpemmokfjbiicoaocpmpdeiobnilpokc"

[extension_signing.firefox]
gecko_id = "focuslock@focuslock.app"
amo_jwt_issuer = "user:..."
amo_jwt_secret = "..."
```

For deployment environments, `scripts/sync-env.ts` should export only the non-secret runtime values
needed by the web app:

```text
EXTENSION_ARTIFACTS_BUCKET
EXTENSION_ARTIFACTS_REGION
EXTENSION_PUBLIC_S3_BASE_URL
EXTENSION_PUBLIC_APP_BASE_URL
EXTENSION_CHROMIUM_UPDATE_URL
EXTENSION_FIREFOX_UPDATE_URL
EXTENSION_FIREFOX_XPI_URL
```

The AWS secret key, Chromium private key, and AMO JWT secret should be used only by the release
script or CI job that uploads artifacts.

## One-Time AWS Setup

Use the root account only to bootstrap the bucket and a narrower deploy identity. After that, the
release process should use a dedicated IAM user or CI role with access only to this bucket.

Create the bucket:

```bash
aws s3api create-bucket \
  --bucket focuslock-extension-artifacts-prod \
  --region us-east-1
```

Keep object ownership simple:

```bash
aws s3api put-bucket-ownership-controls \
  --bucket focuslock-extension-artifacts-prod \
  --ownership-controls '{
    "Rules": [{ "ObjectOwnership": "BucketOwnerEnforced" }]
  }'
```

Disable public bucket listing, but allow public reads of extension artifacts:

```bash
aws s3api put-public-access-block \
  --bucket focuslock-extension-artifacts-prod \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": false,
    "RestrictPublicBuckets": false
  }'

aws s3api put-bucket-policy \
  --bucket focuslock-extension-artifacts-prod \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "PublicReadExtensionArtifacts",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::focuslock-extension-artifacts-prod/ext/*"
      }
    ]
  }'
```

Set CORS permissively for public GETs:

```bash
aws s3api put-bucket-cors \
  --bucket focuslock-extension-artifacts-prod \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedOrigins": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 3000
      }
    ]
  }'
```

Create a deploy IAM identity with permissions limited to:

```text
s3:GetObject
s3:PutObject
s3:DeleteObject
s3:ListBucket
```

Scope `ListBucket` to `focuslock-extension-artifacts-prod` and object actions to
`arn:aws:s3:::focuslock-extension-artifacts-prod/ext/*`.

## Release Artifacts

The release job should produce:

```text
apps/extension/release/chromium/focuslock-<version>.crx
apps/extension/release/chromium/updates.xml
apps/extension/release/firefox/focuslock-<version>.xpi
apps/extension/release/firefox/updates.json
apps/extension/release/ids.json
```

Chromium `updates.xml` should look like:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='cpemmokfjbiicoaocpmpdeiobnilpokc'>
    <updatecheck
      codebase='https://focuslock.app/ext/chromium/focuslock-0.1.0.crx'
      version='0.1.0' />
  </app>
</gupdate>
```

Firefox `updates.json` should look like:

```json
{
  "addons": {
    "focuslock@focuslock.app": {
      "updates": [
        {
          "version": "0.1.0",
          "update_link": "https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi"
        }
      ]
    }
  }
}
```

Upload with exact content types:

```bash
aws s3 cp apps/extension/release/chromium/focuslock-0.1.0.crx \
  s3://focuslock-extension-artifacts-prod/ext/chromium/focuslock-0.1.0.crx \
  --content-type application/x-chrome-extension \
  --cache-control public,max-age=31536000,immutable

aws s3 cp apps/extension/release/chromium/updates.xml \
  s3://focuslock-extension-artifacts-prod/ext/chromium/updates.xml \
  --content-type application/xml \
  --cache-control no-cache

aws s3 cp apps/extension/release/firefox/focuslock-0.1.0.xpi \
  s3://focuslock-extension-artifacts-prod/ext/firefox/focuslock-0.1.0.xpi \
  --content-type application/x-xpinstall \
  --cache-control public,max-age=31536000,immutable

aws s3 cp apps/extension/release/firefox/updates.json \
  s3://focuslock-extension-artifacts-prod/ext/firefox/updates.json \
  --content-type application/json \
  --cache-control no-cache
```

## Release Script Work

Add `scripts/release-extension.mjs` to automate the flow:

1. read `.credentials`;
2. run `scripts/build-extension.mjs`;
3. inject production update URLs into the Chromium and Firefox manifests;
4. package Chromium with the stable private key;
5. sign Firefox with `web-ext sign --channel=unlisted`;
6. generate `updates.xml`, `updates.json`, and `ids.json`;
7. fail if the Chromium id does not match `expected_extension_id`;
8. upload artifacts to S3 with the content types and cache headers above;
9. print the public app URLs that native policy installers should use.

The Chromium private key must remain stable forever for this extension line. Rotating it changes the
extension id and breaks existing force-install/native-messaging allowlists.

## Web App Work

Add Next.js routes under the web app:

```text
apps/web/src/app/ext/chromium/updates.xml/route.ts
apps/web/src/app/ext/chromium/[filename]/route.ts
apps/web/src/app/ext/firefox/updates.json/route.ts
apps/web/src/app/ext/firefox/[filename]/route.ts
```

Behavior:

- metadata routes fetch `ext/chromium/updates.xml` and `ext/firefox/updates.json` from S3 and
  return the body with `application/xml` or `application/json`;
- artifact routes validate the filename pattern and redirect to the S3 object URL;
- return `404` for unknown files rather than exposing a general S3 proxy;
- optionally record update-check and artifact-download events before serving/redirecting.

The app should keep S3 as source of truth, like owl's release service does, so changing the S3
metadata changes browser update behavior without rebuilding the website.

## Native Policy Work

Windows should consume the app URLs:

```rust
pub const CHROMIUM_UPDATE_URL: &str = "https://focuslock.app/ext/chromium/updates.xml";
pub const FIREFOX_XPI_URL: &str = "https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi";
```

Linux policy registration should use the same URLs when writing managed browser policy files.

The Firefox extension manifest should include:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "focuslock@focuslock.app",
      "strict_min_version": "115.0",
      "update_url": "https://focuslock.app/ext/firefox/updates.json"
    }
  }
}
```

The Chromium build should include:

```json
{
  "update_url": "https://focuslock.app/ext/chromium/updates.xml"
}
```

## Implementation Status

Current as of 2026-06-19:

Done:

- `.credentials.example` already documents `[aws]`, `[extension_hosting]`, and
  `[extension_signing]`.
- `scripts/sync-env.ts` now validates those sections and exports only the non-secret web runtime
  values:
  `EXTENSION_ARTIFACTS_BUCKET`, `EXTENSION_ARTIFACTS_REGION`,
  `EXTENSION_PUBLIC_S3_BASE_URL`, `EXTENSION_PUBLIC_APP_BASE_URL`,
  `EXTENSION_CHROMIUM_UPDATE_URL`, `EXTENSION_FIREFOX_UPDATE_URL`, and
  `EXTENSION_FIREFOX_XPI_URL`.
- `apps/web/src/lib/config.ts` now validates and exposes those runtime values under
  `config.extensionHosting`.
- The web app now has a public extension route at
  `apps/web/src/app/ext/[engine]/[...path]/route.ts`.
  It allows only `chromium/updates.xml`, `chromium/focuslock-<version>.crx`,
  `firefox/updates.json`, and `firefox/focuslock-<version>.xpi`; metadata is fetched from S3 with
  `no-cache`, and binary artifacts redirect to S3.
- `scripts/release-extension.mjs` has been added and wired to `pnpm release:extension`. It reads
  `.credentials`, runs `scripts/build-extension.mjs`, injects update URLs into staged manifests,
  packages Chromium as CRX3 using the configured stable key, signs Firefox through
  `web-ext sign --channel=unlisted`, writes `updates.xml`, `updates.json`, and `ids.json`, verifies
  the Chromium id, and uploads artifacts to S3 with the documented content types/cache headers.
- `apps/extension/release/` is ignored as generated output.
- Windows native policy constants now point at:
  `https://focuslock.app/ext/chromium/updates.xml` and
  `https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi`.
- Web test setup has defaults for the new extension hosting env vars so config imports have a
  complete server env during unit tests.

Partially verified:

- `node --check scripts/release-extension.mjs` passed.
- `apps/web/tests/unit/config.test.ts` showed as passing during an interrupted broader Vitest run.

Not verified yet:

- `scripts/release-extension.mjs` has not been run end-to-end because this checkout does not have a
  real `.credentials` file, AMO credentials, or an initialized release bucket.
- The CRX3 package produced by the Node implementation still needs a real browser install/update
  check.
- The Firefox signing path depends on `web-ext` being available on `PATH` and valid AMO unlisted
  signing credentials.
- The Next route has not been exercised against live S3 objects.
- Full web typecheck/test runs were started but stopped before completion at the user's request.

Still to do:

- Create or verify the `focuslock-extension-artifacts-prod` bucket, public-read policy for
  `ext/*`, CORS, and the narrow deploy identity.
- Add real values to local/CI `.credentials`, including AWS deploy credentials, Chromium stable key
  path, expected Chromium id, and AMO JWT credentials.
- Install or pin `web-ext` for the release environment if it should not be assumed globally
  available.
- Run `pnpm release:extension` with real credentials and inspect the generated files under
  `apps/extension/release/`.
- Upload artifacts and confirm:
  `curl -I https://focuslock.app/ext/chromium/updates.xml`,
  `curl -I https://focuslock.app/ext/chromium/focuslock-0.1.0.crx`,
  `curl -I https://focuslock.app/ext/firefox/updates.json`, and
  `curl -I https://focuslock.app/ext/firefox/focuslock-0.1.0.xpi`.
- Force-install Chromium and Firefox on a clean Windows VM and confirm download, install,
  native-messaging allowlists, and update behavior.
- Decide whether to add telemetry in the app route before returning metadata/redirect responses.

## Validation

Before shipping:

1. verify `curl -I` on the app routes returns correct content types;
2. verify the S3 artifact URLs are public but bucket listing is not;
3. force-install the Chromium extension from policy and confirm it downloads from the update URL;
4. force-install Firefox from policy and confirm the signed XPI installs;
5. publish a test version bump and confirm browser auto-update behavior;
6. confirm the native-messaging host allowlists match the final Chromium id and Firefox Gecko id.

## Open Decisions

- Whether artifact routes should redirect to S3 or proxy bytes. Start with redirects; proxy only if
  a supported browser fails to install/update through redirects.
- Whether to add CloudFront later. S3 HTTPS is enough for the first release, but CloudFront gives
  better cache control, logs, and a cleaner artifact domain if needed.
- Whether to publish Chromium through browser stores for Windows Chrome/Edge. We still need clean VM
  validation that local machine force-install accepts the self-hosted update URL on every supported
  Windows Chromium-family browser.
