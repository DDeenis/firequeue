import {
  EventStatus,
  StepStatus,
  TaskStatus,
  type FirequeueEvent,
  type Step,
  type Task,
} from "./types.js";
import { removeTrailingSlash } from "./utils.js";

export class FirestoreTasksStorage {
  constructor(private firestore: FirebaseFirestore.Firestore) {}

  public getTaskDocumentPath(input: {
    taskInstanceId: string;
    collectionPath: string;
  }) {
    return `${removeTrailingSlash(input.collectionPath)}/${
      input.taskInstanceId
    }`;
  }

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

    return collection.doc(id).set(newTask, { merge: false });
  }

  public updateTask(taskDocumentPath: string, updates: Partial<Task>) {
    const taskDocRef = this.getTaskRef(taskDocumentPath);
    return taskDocRef.update(updates);
  }

  public async scheduleTaskIfNotRunning(taskDocumentPath: string) {
    const taskDocRef = this.getTaskRef(taskDocumentPath);

    await this.firestore.runTransaction(async (trx) => {
      const taskDoc = await trx.get(taskDocRef);
      const taskData = taskDoc.data();

      if (!taskData || taskData.status === TaskStatus.Running) return;

      trx.update(taskDocRef, { status: TaskStatus.Scheduled });
    });
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

    return stepRef.set(
      {
        stepId,
        serializedResult: null,
        status: StepStatus.Scheduled,
      },
      { merge: false }
    );
  }

  public async updateStep(
    taskDocumentPath: string,
    stepId: string,
    updates: Partial<Step>
  ) {
    const stepRef = this.getStepRef(taskDocumentPath, stepId);

    return stepRef.update(updates);
  }

  public async markStepsAndTaskWithStatus({
    taskInstanceId,
    collectionPath,
    stepIds,
    taskStatus,
    stepsStatus,
  }: {
    taskInstanceId: string;
    collectionPath: string;
    stepIds: string[];
    taskStatus: TaskStatus;
    stepsStatus: StepStatus;
  }) {
    const taskDocumentPath = this.getTaskDocumentPath({
      taskInstanceId,
      collectionPath,
    });

    const taskRef = this.getTaskRef(taskDocumentPath);
    const stepRefs = stepIds.map((stepId) =>
      this.getStepRef(taskDocumentPath, stepId)
    );

    await this.firestore.runTransaction(async (trx) => {
      for (const stepRef of stepRefs) {
        trx.update(stepRef, { status: stepsStatus });
      }

      trx.update(taskRef, { status: taskStatus });
    });
  }

  public getEventRef(taskDocumentPath: string, eventId: string) {
    const eventsCollection = this.firestore.collection(
      `${taskDocumentPath}/events`
    );

    return eventsCollection.doc(
      eventId
    ) as FirebaseFirestore.DocumentReference<FirequeueEvent>;
  }

  public getEvent(
    taskDocumentPath: string,
    eventId: string
  ): Promise<FirequeueEvent | null> {
    return this.getEventRef(taskDocumentPath, eventId)
      .get()
      .then((doc) => doc.data() ?? null);
  }

  public getAndConsumeEvent(
    taskDocumentPath: string,
    eventId: string
  ): Promise<FirequeueEvent | null> {
    const eventRef = this.getEventRef(taskDocumentPath, eventId);

    return this.firestore.runTransaction(async (trx) => {
      const eventDoc = await trx.get(eventRef);

      if (!eventDoc.exists) return null;

      const eventData = eventDoc.data();

      if (!eventData || eventData.status === EventStatus.Consumed) return null;

      trx.update(eventRef, {
        status: EventStatus.Consumed,
      });

      return eventData;
    });
  }

  public consumeEvent(taskDocumentPath: string, eventId: string) {
    const eventRef = this.getEventRef(taskDocumentPath, eventId);

    return eventRef.update({
      status: EventStatus.Consumed,
    });
  }

  public createEvent(taskDocumentPath: string, eventId: string) {
    const eventRef = this.getEventRef(taskDocumentPath, eventId);

    return eventRef.set(
      {
        eventId,
        status: EventStatus.Received,
        createdAt: Date.now(),
      },
      { merge: false }
    );
  }
}
