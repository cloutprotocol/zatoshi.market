/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as inscriptions from "../inscriptions.js";
import type * as inscriptionsActions from "../inscriptionsActions.js";
import type * as jobs from "../jobs.js";
import type * as jobsActions from "../jobsActions.js";
import type * as sales from "../sales.js";
import type * as testAction from "../testAction.js";
import type * as txContexts from "../txContexts.js";
import type * as users from "../users.js";
import type * as utxoLocks from "../utxoLocks.js";
import type * as zcashHelpers from "../zcashHelpers.js";
import type * as zmaps from "../zmaps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  inscriptions: typeof inscriptions;
  inscriptionsActions: typeof inscriptionsActions;
  jobs: typeof jobs;
  jobsActions: typeof jobsActions;
  sales: typeof sales;
  testAction: typeof testAction;
  txContexts: typeof txContexts;
  users: typeof users;
  utxoLocks: typeof utxoLocks;
  zcashHelpers: typeof zcashHelpers;
  zmaps: typeof zmaps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
