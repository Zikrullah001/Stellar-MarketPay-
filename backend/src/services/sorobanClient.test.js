"use strict";

const mockContractCalls = [];
const mockSources = [];
const mockPage = new Map([
  [
    "disputes",
    [
      new Map([
        ["job_id", "job-1"],
        ["status", "Disputed"],
        ["client", "GCLIENT"],
        ["freelancer", "GFREELANCER"],
        ["bond", 25n],
      ]),
    ],
  ],
  ["next_cursor", 2n],
]);

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");

  class MockServer {
    simulateTransaction = jest.fn(async () => ({ result: { retval: {} } }));
  }

  class MockTransactionBuilder {
    constructor(source) {
      mockSources.push(source);
    }

    addOperation() {
      return this;
    }

    build() {
      return {};
    }
  }

  class MockContract {
    call(...args) {
      mockContractCalls.push(args);
      return {};
    }
  }

  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: MockServer,
      TransactionBuilder: MockTransactionBuilder,
      Api: { ...actual.SorobanRpc.Api, isSimulationError: () => false },
    },
    Contract: MockContract,
    scValToNative: () => mockPage,
  };
});

const { getAllDisputes } = require("./sorobanClient");

afterEach(() => {
  mockContractCalls.length = 0;
  mockSources.length = 0;
});

test("getAllDisputes encodes cursors and returns decoded dispute summaries", async () => {
  const page = await getAllDisputes({
    contractId: "C" + "A".repeat(55),
    admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    limit: 10,
  });

  expect(mockContractCalls[0][0]).toBe("get_all_disputes");
  expect(mockSources[0].accountId()).toBe(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  );
  expect(mockContractCalls[0][1].switch().name).toBe("scvVoid");
  expect(page).toEqual({
    disputes: [
      {
        jobId: "job-1",
        status: "Disputed",
        client: "GCLIENT",
        freelancer: "GFREELANCER",
        bond: 25n,
      },
    ],
    nextCursor: "2",
  });

  await getAllDisputes({
    contractId: "C" + "A".repeat(55),
    admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    startAfter: "9007199254740993",
    limit: 10,
  });
  expect(mockContractCalls[1][1].switch().name).toBe("scvU64");
  expect(mockContractCalls[1][1].u64().toString()).toBe("9007199254740993");
});

test("getAllDisputes rejects out-of-range page limits", async () => {
  await expect(
    getAllDisputes({
      contractId: "C" + "A".repeat(55),
      admin: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      limit: 51,
    }),
  ).rejects.toThrow("limit must be between 1 and 50");
});