import { action } from "./_generated/server";
import { v } from "convex/values";
import { broadcastTransaction, fetchUtxos, getConsensusBranchId } from "./zcashHelpers";

export const broadcast = action({
    args: { hex: v.string() },
    handler: async (ctx, args) => {
        return await broadcastTransaction(args.hex);
    },
});

export const getUtxosAction = action({
    args: { address: v.string() },
    handler: async (ctx, args) => {
        return await fetchUtxos(args.address);
    },
});

export const getBranchId = action({
    args: {},
    handler: async (ctx) => {
        return await getConsensusBranchId();
    },
});
