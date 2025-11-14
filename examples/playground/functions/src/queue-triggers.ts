import { firequeue } from "./init";

export const onTaskWritten = firequeue.createTask(
  "test-task",
  { collectionPath: "queue" },
  async ({ step }) => {
    const r1 = await step.run("step-1", async () => 1);
    const r2 = await step.run("step-2", async () => r1 + 2);
    const r3 = await step.run("step-3", async () => r2 + 3);

    // const rand = Math.random();
    // console.log("Random num:", rand);

    // if (rand > 0.5) {
    //   await step.run("step-conditional", async () =>
    //     console.log("This step was executed conditionally!")
    //   );
    // }

    await step.run("step-final", async () => {
      console.log("Result:", r3, r3 === 6);
    });
  }
);
