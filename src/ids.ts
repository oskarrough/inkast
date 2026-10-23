import * as Effect from "effect/Effect";

// No l, o, 0 or 1, and 32 letters so a random byte maps without bias.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const ID = /^[a-km-np-z2-9]{8}$/;

const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes));
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const isId = (value: string) => ID.test(value);
export const newId = () => Array.from(random(8), (b) => ALPHABET[b % 32]).join("");
export const newKey = () => `k_${hex(random(16))}`;

export const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) => hex(new Uint8Array(digest))),
  );
