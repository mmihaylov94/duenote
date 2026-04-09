import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

/** True when bucket and region are set — new uploads use S3; otherwise local disk. */
export function isS3Configured() {
  return Boolean(config.s3Bucket && config.s3Region);
}

/**
 * S3 client for app uploads (profile avatars, course materials).
 * If AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are both set, those are used;
 * otherwise the SDK uses the default chain (EC2/ECS/Lambda instance role, env, profile).
 */
export function createS3Client() {
  const opts = { region: config.s3Region };
  if (config.awsAccessKeyId && config.awsSecretAccessKey) {
    opts.credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    };
  }
  return new S3Client(opts);
}
