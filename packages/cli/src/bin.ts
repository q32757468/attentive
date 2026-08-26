#!/usr/bin/env node

import { run } from "./cli.js";

void run().then((exitCode) => {
  process.exitCode = exitCode;
});
