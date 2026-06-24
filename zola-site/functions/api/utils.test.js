// functions/api/utils.test.js
import { validateUuid, validateWebpHeader, validateAST } from "./utils.js";

console.log("Running utils validation tests...");

// Test UUID
const validUuid = "e883ba56-42d8-4f2b-871c-a33d258b3ff5";
console.assert(validateUuid(validUuid) === true, "Valid UUID failed");
console.assert(validateUuid("invalid-uuid") === false, "Invalid UUID passed");

// Test WebP Magic
const mockWebp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]).buffer;
console.assert(validateWebpHeader(mockWebp) === true, "WebP header check failed");

// Test AST
const validAst = JSON.stringify({ type: "Spline", bounding_box: [0, 0, 10, 10], equations: [] });
console.assert(validateAST(validAst) === true, "Valid AST parsing failed");

console.log("All utility checks passed!");
