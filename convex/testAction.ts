"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { addressToPkh, bytesToHex } from "./zcashHelpers";

export const simpleTest = action({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("Step 1: Action started for address:", args.address);

      const pkh = addressToPkh(args.address);
      console.log("Step 2: addressToPkh succeeded, PKH:", bytesToHex(pkh));

      return {
        success: true,
        pkh: bytesToHex(pkh)
      };
    } catch (error) {
      console.error("Test failed:", error);
      const err = error as Error;
      return {
        success: false,
        error: String(error),
        message: err.message,
        name: err.name,
        stack: err.stack
      };
    }
  }
});
