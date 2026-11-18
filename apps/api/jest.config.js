module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@speak2split/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
};

