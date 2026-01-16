#!/usr/bin/env node
/**
 * Generates JWT_PRIVATE_KEY and JWKS for Convex Auth.
 * Run: node generateKeys.mjs
 * Copy the output to your Convex dashboard environment variables.
 */

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

console.log("Add these to your Convex dashboard environment variables:\n");
console.log("JWT_PRIVATE_KEY:");
console.log(privateKey);
console.log("\nJWKS:");
console.log(jwks);
