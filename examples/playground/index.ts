import * as readline from "readline";

// This script runs as a Node.js console app to interact with the Firebase emulator.

/**
 * Invokes the test task by sending a POST request to the emulator.
 */
async function invokeTask() {
  console.log("\nInvoking task...");

  // TODO: Replace with your project ID and region if different.
  const projectId = "firequeue-ecbba"; // Replace if needed
  const region = "us-central1"; // Replace if needed
  const functionName = "invokeTestTask";
  const url = `http://127.0.0.1:5001/${projectId}/${region}/${functionName}`;

  try {
    const response = await fetch(url, { method: "POST" });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP error! Status: ${response.status}, Response: ${text}`
      );
    }

    console.log("✅ Invocation successful:", text);
  } catch (error) {
    console.error("❌ Failed to invoke task:", error);
  } finally {
    console.log(
      "\nPress 'r' to invoke again, 'p' for the demo, or 'q' to exit."
    );
  }
}

/**
 * Invokes the product review aggregation demo task by sending a POST request to the emulator.
 */
async function invokeProductReviewDemo() {
  console.log("\nInvoking product review demo function...");

  const projectId = "firequeue-ecbba"; // Replace if needed
  const region = "us-central1"; // Replace if needed
  const functionName = "invokeProductReviewAggregation";
  const url = `http://127.0.0.1:5001/${projectId}/${region}/${functionName}`;

  try {
    const response = await fetch(url, { method: "POST" });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP error! Status: ${response.status}, Response: ${text}`
      );
    }

    console.log("✅ Invocation successful:", text);
  } catch (error) {
    console.error("❌ Failed to invoke product review demo:", error);
  } finally {
    console.log(
      "\nPress 'r' to invoke again, 'p' for the demo, or 'q' to exit."
    );
  }
}

// Setup readline to listen for keypresses
readline.emitKeypressEvents(process.stdin);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

console.log("🚀 Console App Started");
console.log("Press 'r' to invoke the test task.");
console.log("Press 'p' to invoke the product review aggregation demo.");
console.log("Press 'q' or Ctrl+C to exit.");

process.stdin.on("keypress", (str, key) => {
  // Exit on Ctrl+C or 'q'
  if ((key.ctrl && key.name === "c") || key.name === "q") {
    console.log("\nExiting...");
    process.exit(0);
  }

  // Invoke task on 'r'
  if (key.name === "r") {
    invokeTask();
  }

  // Invoke product review demo on 'p'
  if (key.name === "p") {
    invokeProductReviewDemo();
  }
});
