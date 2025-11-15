import { StepStatus, TaskStatus, type Step, type Task } from "./types.js";
import { removeTrailingSlash } from "./utils.js";

export class FirestoreTasksStorage {
  constructor(private firestore: FirebaseFirestore.Firestore) {}

  public getTaskRef(taskDocumentPath: string) {
    return this.firestore.doc(
      taskDocumentPath
    ) as FirebaseFirestore.DocumentReference<Task>;
  }

  public async createTask({
    taskId,
    collectionPath,
    serializedInputData,
  }: {
    taskId: string;
    collectionPath: string;
    serializedInputData: string | null;
  }) {
    const collection = this.firestore.collection(
      removeTrailingSlash(collectionPath)
    );

    const id = `${taskId}-${collection.doc().id}`;
    const newTask: Task = {
      taskId,
      instanceId: id,
      status: TaskStatus.Scheduled,
      serializedInputData,
    };

    return collection.doc(id).set(newTask);
  }

  public updateTask(taskDocumentPath: string, updates: Partial<Task>) {
    const taskDocRef = this.getTaskRef(taskDocumentPath);
    return taskDocRef.update(updates);
  }

  public getStepRef(taskDocumentPath: string, stepId: string) {
    const stepsCollection = this.firestore.collection(
      `${taskDocumentPath}/steps`
    );

    return stepsCollection.doc(
      stepId
    ) as FirebaseFirestore.DocumentReference<Step>;
  }

  public getStep(
    taskDocumentPath: string,
    stepId: string
  ): Promise<Step | null> {
    return this.getStepRef(taskDocumentPath, stepId)
      .get()
      .then((doc) => doc.data() ?? null);
  }

  public getAllSteps(taskDocumentPath: string): Promise<Step[]> {
    const stepsCollection = this.firestore.collection(
      `${taskDocumentPath}/steps`
    ) as FirebaseFirestore.CollectionReference<Step>;

    return stepsCollection
      .get()
      .then(({ docs }) => docs.map((doc) => doc.data()));
  }

  public async createStep(taskDocumentPath: string, stepId: string) {
    const stepRef = this.getStepRef(taskDocumentPath, stepId);

    await this.firestore.runTransaction(async (trx) => {
      return trx.create(stepRef, {
        stepId,
        serializedResult: null,
        status: StepStatus.Scheduled,
      } satisfies Step);
    });
  }

  public async updateStep(
    taskDocumentPath: string,
    stepId: string,
    updates: Partial<Step>
  ) {
    const stepRef = this.getStepRef(taskDocumentPath, stepId);

    await this.firestore.runTransaction(async (trx) => {
      return trx.update(stepRef, updates);
    });
  }

  public async markStepsForExecution({
    taskInstanceId,
    collectionPath,
    stepIds,
  }: {
    taskInstanceId: string;
    collectionPath: string;
    stepIds: string[];
  }) {
    const taskDocumentPath = `${collectionPath}/${taskInstanceId}`;

    const taskRef = this.getTaskRef(taskDocumentPath);
    const stepRefs = stepIds.map((stepId) =>
      this.getStepRef(taskDocumentPath, stepId)
    );

    await this.firestore.runTransaction(async (trx) => {
      for (const stepRef of stepRefs) {
        trx.update(stepRef, { status: StepStatus.Scheduled });
      }

      trx.update(taskRef, { status: TaskStatus.Scheduled });
    });
  }
}
