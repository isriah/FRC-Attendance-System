import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const PIN_PATTERN = /^\d{6,12}$/;
const KEY_LENGTH = 32;

interface StoredNetworkPin {
  version: 1;
  algorithm: "scrypt";
  salt: string;
  verifier: string;
}

export function validateNetworkPin(pin: unknown): string {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    throw new Error("Use a numeric PIN with 6 to 12 digits.");
  }
  return pin;
}

export async function hasNetworkPin(path: string): Promise<boolean> {
  try {
    await readStoredNetworkPin(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw new Error("The local network PIN verifier could not be read.");
  }
}

export async function configureNetworkPin(path: string, pin: unknown, confirmation: unknown): Promise<void> {
  const validPin = validateNetworkPin(pin);
  if (validPin !== confirmation) throw new Error("The PIN entries do not match. Try again.");

  const salt = randomBytes(16);
  const verifier = await deriveVerifier(validPin, salt);
  const stored: StoredNetworkPin = {
    version: 1,
    algorithm: "scrypt",
    salt: salt.toString("base64"),
    verifier: verifier.toString("base64")
  };
  const temporaryPath = join(dirname(path), `.${randomBytes(12).toString("hex")}.network-pin.tmp`);
  await writeFile(temporaryPath, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

export async function verifyNetworkPin(path: string, pin: unknown): Promise<boolean> {
  const validPin = validateNetworkPin(pin);
  const stored = await readStoredNetworkPin(path);
  const actual = Buffer.from(stored.verifier, "base64");
  const expected = await deriveVerifier(validPin, Buffer.from(stored.salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function resetNetworkPin(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function readStoredNetworkPin(path: string): Promise<StoredNetworkPin> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredNetworkPin>;
  if (parsed.version !== 1 || parsed.algorithm !== "scrypt" || typeof parsed.salt !== "string" || typeof parsed.verifier !== "string") {
    throw new Error("Invalid network PIN verifier");
  }
  const salt = Buffer.from(parsed.salt, "base64");
  const verifier = Buffer.from(parsed.verifier, "base64");
  if (salt.length < 16 || verifier.length !== KEY_LENGTH) throw new Error("Invalid network PIN verifier");
  return parsed as StoredNetworkPin;
}

async function deriveVerifier(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(pin, salt, KEY_LENGTH, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
