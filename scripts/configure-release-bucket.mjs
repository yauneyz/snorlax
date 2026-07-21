#!/usr/bin/env node
/** Idempotently configure bounded/recoverable release hosting on the existing S3 bucket. */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import toml from "@iarna/toml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const credentialsPath = [
  join(root, ".credentials"),
  resolve(root, "../indigo/.credentials"),
].find((candidate) => existsSync(candidate));
const hosting =
  process.env.RELEASE_ARTIFACTS_BUCKET && process.env.RELEASE_PUBLIC_BASE_URL
    ? {
        region:
          process.env.AWS_REGION ??
          process.env.AWS_DEFAULT_REGION ??
          "us-east-1",
        bucket: process.env.RELEASE_ARTIFACTS_BUCKET,
      }
    : credentialsPath
      ? (() => {
          const credentials = toml.parse(readFileSync(credentialsPath, "utf8"));
          const region = credentials.aws?.region;
          const bucket = credentials.extension_hosting?.bucket;
          if (!region || !bucket) {
            throw new Error(
              ".credentials must define aws.region and extension_hosting.bucket",
            );
          }
          return { region, bucket };
        })()
      : (() => {
          throw new Error(
            "Missing .credentials or release-hosting environment variables",
          );
        })();
// Infrastructure changes use the operator's ambient AWS CLI session. Artifact uploader keys in
// .credentials are intentionally ignored.
const env = { ...process.env, AWS_DEFAULT_REGION: hosting.region };

function aws(args, capture = false) {
  return execFileSync("aws", args, {
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function awsJson(args, missingValue) {
  const result = spawnSync("aws", args, { env, encoding: "utf8" });
  if (result.status === 0) return JSON.parse(result.stdout || "{}");
  if (result.stderr.includes("NoSuch")) return missingValue;
  throw new Error(result.stderr.trim() || `aws ${args.join(" ")} failed`);
}

aws([
  "s3api",
  "put-bucket-versioning",
  "--bucket",
  hosting.bucket,
  "--versioning-configuration",
  "Status=Enabled",
]);

const lifecycle = awsJson(
  [
    "s3api",
    "get-bucket-lifecycle-configuration",
    "--bucket",
    hosting.bucket,
    "--output",
    "json",
  ],
  { Rules: [] },
);
const lifecycleRule = {
  ID: "BoundReleaseArtifactHistory",
  Status: "Enabled",
  Filter: { Prefix: "" },
  NoncurrentVersionExpiration: { NoncurrentDays: 14 },
  Expiration: { ExpiredObjectDeleteMarker: true },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
};
const rules = [
  ...(lifecycle.Rules ?? []).filter((rule) => rule.ID !== lifecycleRule.ID),
  lifecycleRule,
];
aws([
  "s3api",
  "put-bucket-lifecycle-configuration",
  "--bucket",
  hosting.bucket,
  "--lifecycle-configuration",
  JSON.stringify({ Rules: rules }),
]);

const currentPolicyResult = awsJson(
  [
    "s3api",
    "get-bucket-policy",
    "--bucket",
    hosting.bucket,
    "--output",
    "json",
  ],
  { Policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }) },
);
const currentPolicy = JSON.parse(currentPolicyResult.Policy);
const publicRead = {
  Sid: "PublicReadReleaseArtifacts",
  Effect: "Allow",
  Principal: "*",
  Action: "s3:GetObject",
  Resource: ["app", "ext", "desktop", "apt"].map(
    (prefix) => `arn:aws:s3:::${hosting.bucket}/${prefix}/*`,
  ),
};
currentPolicy.Statement = [
  ...(currentPolicy.Statement ?? []).filter(
    (statement) => statement.Sid !== publicRead.Sid,
  ),
  publicRead,
];
aws([
  "s3api",
  "put-bucket-policy",
  "--bucket",
  hosting.bucket,
  "--policy",
  JSON.stringify(currentPolicy),
]);

console.log(
  `Configured s3://${hosting.bucket}: versioning enabled, 14-day noncurrent cleanup, bounded public prefixes.`,
);
