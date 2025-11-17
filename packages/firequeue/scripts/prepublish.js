import { rimraf } from "rimraf";
import { copyFile } from "fs/promises";
import { resolve } from "path";

const sourcePath = resolve("../../README.md");
const destinationPath = resolve("./README.md");
const libDir = resolve("./lib");

await Promise.all([rimraf(libDir), copyFile(sourcePath, destinationPath)]);
