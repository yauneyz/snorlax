#!/usr/bin/env node
/** Idempotently configure GitHub Actions OIDC and the least-privilege release role. */

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
// IAM changes require an administrative operator identity. Deliberately use the ambient AWS CLI
// session instead of the restricted artifact-uploader keys stored in .credentials.
const env = { ...process.env, AWS_DEFAULT_REGION: hosting.region };

const repository = process.env.GITHUB_RELEASE_REPOSITORY ?? "yauneyz/snorlax";
const githubEnvironment =
  process.env.GITHUB_RELEASE_ENVIRONMENT ?? "production";
const roleName = process.env.AWS_RELEASE_ROLE_NAME ?? "TalysmanGitHubRelease";
const providerHost = "token.actions.githubusercontent.com";

function aws(args, capture = false) {
  return execFileSync("aws", args, {
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function awsResult(args) {
  return spawnSync("aws", args, { env, encoding: "utf8" });
}

const accountId = aws(
  ["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
  true,
).trim();
const providerArn = `arn:aws:iam::${accountId}:oidc-provider/${providerHost}`;
const providers =
  JSON.parse(
    aws(["iam", "list-open-id-connect-providers", "--output", "json"], true),
  ).OpenIDConnectProviderList ?? [];
if (!providers.some((provider) => provider.Arn === providerArn)) {
  aws([
    "iam",
    "create-open-id-connect-provider",
    "--url",
    `https://${providerHost}`,
    "--client-id-list",
    "sts.amazonaws.com",
    "--tags",
    "Key=Project,Value=Talysman",
  ]);
}

const trustPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Federated: providerArn },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: {
          [`${providerHost}:aud`]: "sts.amazonaws.com",
          [`${providerHost}:sub`]: `repo:${repository}:environment:${githubEnvironment}`,
        },
      },
    },
  ],
};
const existingRole = awsResult(["iam", "get-role", "--role-name", roleName]);
if (existingRole.status === 0) {
  aws([
    "iam",
    "update-assume-role-policy",
    "--role-name",
    roleName,
    "--policy-document",
    JSON.stringify(trustPolicy),
  ]);
} else if (existingRole.stderr.includes("NoSuchEntity")) {
  aws([
    "iam",
    "create-role",
    "--role-name",
    roleName,
    "--description",
    "Publishes signed Talysman desktop releases from the protected GitHub production environment",
    "--assume-role-policy-document",
    JSON.stringify(trustPolicy),
    "--tags",
    "Key=Project,Value=Talysman",
  ]);
} else {
  throw new Error(
    existingRole.stderr.trim() || `Unable to inspect IAM role ${roleName}`,
  );
}

const releasePrefixes = ["app", "desktop", "apt"];
const permissionsPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "BucketMetadata",
      Effect: "Allow",
      Action: ["s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
      Resource: `arn:aws:s3:::${hosting.bucket}`,
    },
    {
      Sid: "ListReleasePrefixes",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: `arn:aws:s3:::${hosting.bucket}`,
      Condition: {
        StringLike: {
          "s3:prefix": releasePrefixes.map((prefix) => `${prefix}/*`),
        },
      },
    },
    {
      Sid: "ManageReleaseObjects",
      Effect: "Allow",
      Action: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
      ],
      Resource: releasePrefixes.map(
        (prefix) => `arn:aws:s3:::${hosting.bucket}/${prefix}/*`,
      ),
    },
  ],
};
aws([
  "iam",
  "put-role-policy",
  "--role-name",
  roleName,
  "--policy-name",
  "TalysmanReleaseArtifacts",
  "--policy-document",
  JSON.stringify(permissionsPolicy),
]);

console.log(
  `Configured arn:aws:iam::${accountId}:role/${roleName} for ${repository}:${githubEnvironment}.`,
);
