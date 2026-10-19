"use strict";

const {
  SorobanRpc,
  Contract,
  Account,
  nativeToScVal,
  scValToNative,
  xdr,
} = require("@stellar/stellar-sdk");

const MAX_DISPUTES_PER_PAGE = 50;

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ||
  process.env.STELLAR_RPC_URL ||
  (process.env.STELLAR_NETWORK === "mainnet"
    ? "https://rpc.mainnet.stellar.org"
    : "https://rpc-testnet.stellar.org");

// Keep one RPC client for the lifetime of the process. Creating a Server for
// every contract read creates a new connection and defeats HTTP keep-alive.
// Initialize lazily so importing services in tests does not require an RPC
// constructor in every Stellar SDK mock.
let sorobanServer;

function getServer() {
  if (!sorobanServer) {
    sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL, {
      allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
    });
  }
  return sorobanServer;
}

function getContract(contractId) {
  return new Contract(contractId);
}

async function readContractValue(contractId, method, args = [], sourceAddress = null) {
  const server = getServer();
  const contract = getContract(contractId);
  const sourceAccount = sourceAddress ? new Account(sourceAddress, "0") : undefined;

  const result = await server.simulateTransaction(
    new SorobanRpc.TransactionBuilder(sourceAccount, {
      networkPassphrase:
        process.env.STELLAR_NETWORK === "mainnet"
          ? "Public Global Stellar Network ; September 2015"
          : "Test SDF Network ; September 2015",
    })
      .addOperation(contract.call(method, ...args))
      .build(),
  );

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `Soroban simulation failed for ${method}: ${result.error}`,
    );
  }

  return result.result ?? null;
}

function normalizeDisputePage(value) {
  const field = (record, name) =>
    record instanceof Map ? record.get(name) : record?.[name];
  const disputes = field(value, "disputes");
  const nextCursor = field(value, "next_cursor");

  return {
    disputes: Array.isArray(disputes)
      ? disputes.map((dispute) => ({
          jobId: field(dispute, "job_id"),
          status: field(dispute, "status"),
          client: field(dispute, "client"),
          freelancer: field(dispute, "freelancer"),
          bond: field(dispute, "bond") ?? null,
        }))
      : [],
    nextCursor: nextCursor == null ? null : nextCursor.toString(),
  };
}

async function getAllDisputes({
  contractId,
  admin,
  startAfter = null,
  limit = 20,
}) {
  if (typeof contractId !== "string" || !contractId) {
    throw new TypeError("contractId is required");
  }
  if (typeof admin !== "string" || !admin) {
    throw new TypeError("admin is required");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISPUTES_PER_PAGE) {
    throw new RangeError(`limit must be between 1 and ${MAX_DISPUTES_PER_PAGE}`);
  }

  let cursorValue = null;
  if (startAfter !== null) {
    if (
      (typeof startAfter !== "string" && typeof startAfter !== "number" &&
        typeof startAfter !== "bigint") ||
      (typeof startAfter === "number" && !Number.isSafeInteger(startAfter))
    ) {
      throw new TypeError("startAfter must be a non-negative integer cursor");
    }
    try {
      cursorValue = BigInt(startAfter);
    } catch {
      throw new TypeError("startAfter must be a non-negative integer cursor");
    }
    if (cursorValue < 0n || cursorValue > 18446744073709551615n) {
      throw new RangeError("startAfter is outside the u64 range");
    }
  }

  const result = await readContractValue(contractId, "get_all_disputes", [
    cursorValue === null
      ? xdr.ScVal.scvVoid()
      : nativeToScVal(cursorValue, { type: "u64" }),
    nativeToScVal(limit, { type: "u32" }),
  ], admin);
  if (!result?.retval) return { disputes: [], nextCursor: null };
  return normalizeDisputePage(scValToNative(result.retval));
}

module.exports = {
  sorobanServer,
  getServer,
  getContract,
  readContractValue,
  getAllDisputes,
  SOROBAN_RPC_URL,
};
