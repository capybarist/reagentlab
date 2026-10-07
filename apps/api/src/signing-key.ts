import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type SigningKey, generateSigningSeed, signingKeyFromSeed } from "@reagentlab/core";

/**
 * Clave de firma del servidor (ADR-0009). En producción viene de `SIGNING_KEY`; en
 * local se genera una vez y se guarda junto a la base de datos de desarrollo, para
 * que las firmas sigan valiendo al reiniciar.
 */
export function loadSigningKey(seed: string, devKeyPath = "./.data/signing-key"): SigningKey {
  if (seed) return signingKeyFromSeed(seed);
  let devSeed: string;
  try {
    devSeed = readFileSync(devKeyPath, "utf8").trim();
  } catch {
    devSeed = generateSigningSeed();
    mkdirSync(dirname(devKeyPath), { recursive: true });
    writeFileSync(devKeyPath, `${devSeed}\n`, { mode: 0o600 });
  }
  return signingKeyFromSeed(devSeed);
}
