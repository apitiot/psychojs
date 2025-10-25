/**
 * Scheduler.
 *
 * @author Alain Pitiot
 * @copyright (c) 2017-2020 Ilixa Ltd. (http://ilixa.com) (c) 2020-2024 Open Science Tools Ltd. (https://opensciencetools.org)
 * @license Distributed under the terms of the MIT License
 */

/**
 * <p>A scheduler helps run the main loop by managing scheduled functions,
 * called tasks, after each frame is displayed.</p>
 *
 * <p>
 * Tasks are either another [Scheduler]{@link Scheduler}, or a
 * JavaScript functions returning one of the following codes:
 * <ul>
 * <li>Scheduler.Event.NEXT: Move onto the next task *without* rendering the scene first.</li>
 * <li>Scheduler.Event.FLIP_REPEAT: Render the scene and repeat the task.</li>
 * <li>Scheduler.Event.FLIP_NEXT: Render the scene and move onto the next task.</li>
 * <li>Scheduler.Event.QUIT: Quit the scheduler.</li>
 * </ul>
 * </p>
 *
 * <p> It is possible to create sub-schedulers, e.g. to handle loops.
 * Sub-schedulers are added to a parent scheduler as a normal
 * task would be by calling [scheduler.add(subScheduler)]{@link Scheduler#add}.</p>
 *
 * <p> Conditional branching is also available:
 * [scheduler.addConditionalBranches]{@link Scheduler#addConditional}</p>
 */
export class Scheduler
{
	/**
	 * @memberof module:util
	 * @param {module:core.PsychoJS} psychoJS - the PsychoJS instance
	 */
	constructor(psychoJS)
	{
		this._psychoJS = psychoJS;

		// reset the scheduler:
		this.clear();

		// callback triggered whenever a new task is run by the scheduler:
		this._taskCallback = (key, value) =>
		{
			// [do nothing]
		};

		// whether this scheduler is current skipping:
		this._skipping = false;

		// the callback triggered when the scheduler finishes:
		this._finishCallback = () =>
		{
			// [do nothing]
		};

		this._status = Scheduler.Status.STOPPED;
	}

	/**
	 * Get the status of the scheduler.
	 *
	 * @returns {Scheduler#Status} the status of the scheduler
	 */
	get status()
	{
		return this._status;
	}

	/**
	 * Task to be run by the scheduler.
	 *
	 * @callback Scheduler~Task
	 * @param {*} [args] optional arguments
	 */
	/**
	 * Schedule a new task.
	 *
	 * @param {Scheduler~Task | Scheduler} task - the task to be scheduled
	 * @param {...*} args - arguments for that task
	 * @returns {void}
	 */
	add(task, ...args)
	{
		this._nameList.push("<no name>");
		this._taskList.push(task);
		this._argsList.push(args);
	}

	/**
	 * Schedule a new named task.
	 *
	 * @param {string} taskName - the name of the task
	 * @param {Scheduler~Task | Scheduler} task - the task to be scheduled
	 * @param {...*} args - arguments for that task
	 * @returns {void}
	 */
	addNamedTask(taskName, task, ...args)
	{
		this._nameList.push(taskName);
		this._taskList.push(task);
		this._argsList.push(args);
	}

	/**
	 * Condition evaluated when the task is run.
	 *
	 * @callback Scheduler~Condition
	 * @return {boolean}
	 */
	/**
	 * Schedule a series of task or another, based on a condition.
	 *
	 * <p>Note: the tasks are [sub-schedulers]{@link Scheduler}.</p>
	 *
	 * @param {Scheduler~Condition} condition - the condition
	 * @param {Scheduler} thenScheduler - the [Scheduler]{@link Scheduler} to be run if the condition is satisfied
	 * @param {Scheduler} elseScheduler - the [Scheduler]{@link Scheduler} to be run if the condition is not satisfied
	 */
	addConditional(condition, thenScheduler, elseScheduler)
	{
		const task = () =>
		{
			if (condition())
			{
				this.add(thenScheduler);
			}
			else
			{
				this.add(elseScheduler);
			}

			return Scheduler.Event.NEXT;
		};

		this.add(task);
	}

	/**
	 * Empty this scheduler's task list and reset the index.
	 * @returns {void}
	 */
	clear()
	{
		this._taskList = [];
		this._currentTask = undefined;
		this._argsList = [];
		this._currentArgs = undefined;
		this._nameList = [];
		this._currentName = undefined;
		this._taskIndex = -1;

		this._quitAtNextUpdate = false;
		this._quitAtNextTask = false;

		this._scheduledJumpTag = "";
		this._scheduledJumpTaskIndex = -1;
	}

	/**
	 * Start this scheduler.
	 *
	 * <p>Note: tasks are run after each animation frame.</p>
	 *
	 * @return {Promise<void>} a promise resolved when the scheduler stops, e.g. when the experiment finishes
	 */
	start()
	{
		this._status = Scheduler.Status.RUNNING;

		// trigger the scheduler callback:
		this._taskCallback("START_SCHEDULER", undefined);

		let schedulerResolve;
		const update = async (timestamp) =>
		{
			// quit if need be:
			if (this._quitAtNextUpdate)
			{
				this._status = Scheduler.Status.STOPPED;
				schedulerResolve();
				return;
			}

			// run the next scheduled tasks until a scene render is requested:
			if (this._status === Scheduler.Status.RUNNING)
			{
				const state = await this._runNextTasks();

				// quit if need be:
				if (state === Scheduler.Event.QUIT)
				{
					this._status = Scheduler.Status.STOPPED;
					schedulerResolve();
					return;
				}
			}

			// store frame delta for `Window.getActualFrameRate()`
			const lastTimestamp = this._lastTimestamp === undefined ? timestamp : this._lastTimestamp;
			this._lastDelta = timestamp - lastTimestamp;
			this._lastTimestamp = timestamp;

			// render the scene in the window:
			this._psychoJS.window.render();

			// request a new frame:
			requestAnimationFrame(update);
		};

		// start the animation:
		requestAnimationFrame(update);

		// return a promise resolved when the scheduler is stopped:
		return new Promise((resolve, _) =>
		{
			schedulerResolve = resolve;
		});
	}

	/**
	 * Stop this scheduler.
	 *
	 * @return {void}
	 */
	stop()
	{
		// trigger the scheduler callback:
		this._taskCallback("STOP_SCHEDULER", undefined);

		this._status = Scheduler.Status.STOPPED;
		this._quitAtNextTask = true;
		this._quitAtNextUpdate = true;
	}

	/**
	 * Pause this scheduler.
	 *
	 * @return {void}
	 */
	pause()
	{
		// trigger the scheduler callback:
		this._taskCallback("PAUSE_SCHEDULER", undefined);

		this._status = Scheduler.Status.PAUSED;
	}

	/**
	 * Resume this scheduler.
	 *
	 * @return {void}
	 */
	resume()
	{
		// trigger the scheduler callback:
		this._taskCallback("RESUME_SCHEDULER", undefined);

		this._status = Scheduler.Status.RUNNING;
	}

	/**
	 * Condition evaluated when the task is run.
	 *
	 * @callback Scheduler~TaskCallback
	 * @param {string} action
	 * @param {string} taskName
	 * @return {void}
	 */
	/**
	 * Set the callback triggered when the scheduler starts a new task..
	 *
	 * @param {Scheduler~TaskCallback} taskCallback - the callback
	 * @returns {void}
	 */
	setTaskCallback(taskCallback)
	{
		this._taskCallback = taskCallback;
	}

	/**
	 * Show the list of scheduled tasks, mostly for debugging purposes.
	 *
	 * @return {void}
	 */
	showScheduledTasks()
	{
		console.log("%c[Scheduler] task list:", "color: #00AA00");
		console.log(`taskIndex= ${this._taskIndex}`);
		for (let t = 0; t < this._taskList.length; ++t)
		{
			console.log(`\t${t}: ${this._nameList[t]} ${JSON.stringify(this._argsList[t])}`);
		}
	}

	/**
	 * Jump to the task with the given index in to task list.
	 *
	 * @note The current task will terminate normally.
	 *
	 * @param {number} taskIndex - the index of the task in the task list
	 * @return {void}
	 */
	jump(taskIndex)
	{
		const response = {
			origin: "Scheduler.jump",
			context: `when jumping to the task with index: ${taskIndex}`
		};
		console.log(`%c[Scheduler] jumping to task: ${taskIndex}`, "color: #00AA00");

		// check that we can actually jump to that task:
		if (taskIndex < 0 || taskIndex > this._taskList.length - 1)
		{
			throw {...response, error: `unable to jump to a task outside of [0. ${this._taskList.length - 1}]`};
		}

		// note: -1 because _runNextTasks will do ++this._taskIndex
		this._taskIndex = taskIndex - 1;
	}

	/**
	 * Schedule a jump to the task with the given index in to task list.
	 *
	 * The current task will terminate normally. The jump will occur at the next task with the
	 * given tag.
	 *
	 * @param {string} tag - the tag of the task at which to jump
	 * @param {number} taskIndex - the index of the task in the task list
	 * @return {void}
	 */
	scheduleJump(tag, taskIndex)
	{
		const response = {
			origin: "Scheduler.scheduleJump",
			context: `when scheduling a jump to the task with index: ${taskIndex} at the next task with tag: ${tag}`
		};
		console.log(`%c[Scheduler] scheduling jump to task: ${taskIndex} with tag: ${tag}`, "color: #00AA00");

		// check that we can actually jump to that task:
		if (taskIndex < 0 || taskIndex > this._taskList.length - 1)
		{
			throw {...response, error: `unable to jump to a task outside of [0. ${this._taskList.length - 1}]`};
		}

		this._scheduledJumpTag = tag;
		this._scheduledJumpTaskIndex = taskIndex;
	}

	/**
	 * Run the next scheduled tasks, in sequence, until a rendering of the scene is requested.
	 *
	 * @name Scheduler#_runNextTasks
	 * @private
	 * @return {Scheduler#Event} the state of the scheduler after the last task ran
	 */
	async _runNextTasks()
	{
		let state = Scheduler.Event.NEXT;
		while (state === Scheduler.Event.NEXT)
		{
			// check if we need to quit:
			if (this._quitAtNextTask)
			{
				return Scheduler.Event.QUIT;
			}

			// if there is no current task, we look for the next one in the list or quit if there is none:
			if (typeof this._currentTask === "undefined")
			{
				++this._taskIndex;

				// a task is available in the taskList:
				if (this._taskIndex < this._taskList.length)
				{
					this._currentTask = this._taskList[this._taskIndex];
					this._currentArgs = this._argsList[this._taskIndex];
					this._currentName = this._nameList[this._taskIndex];

					this._taskCallback("START_TASK", this._currentName);
				}
				// we have reached the end of the taskList: we quit
				else
				{
					this._currentTask = undefined;
					this._currentArgs = undefined;
					this._currentName = undefined;
					this._skipping = false;

					await this._finishCallback();
					this._finishCallback = () => {};

					return Scheduler.Event.QUIT;
				}
/* DEPRECATED APPROACH (does not allow for moving up and down the task list)
				// a task is available in the taskList:
				if (this._taskList.length > 0)
				{
					this._currentTask = this._taskList.shift();
					this._currentArgs = this._argsList.shift();
					this._currentName = this._nameList.shift();

					this._taskCallback("START_TASK", this._currentName);
				}
				// the taskList is empty: we quit
				else
				{
					this._currentTask = undefined;
					this._currentArgs = undefined;
					this._currentName = undefined;
					return Scheduler.Event.QUIT;
				}
*/
			}
			else
			{
				// we are repeating a task
				// [do nothing]
			}

			// if the current task is a function, we run it:
			if (this._currentTask instanceof Function)
			{
				state = await this._currentTask(...this._currentArgs);

				// if the current trial handler is skipping, we skip to the next task,
				// even if the state returned by the task is not NEXT, unless we have reached
				// the end of the routine
				for (const arg of this._currentArgs)
				{
					if (typeof arg !== "undefined" && arg["@tag"] === "end")
					{
						this._skipping = false;
						break;
					}
				}

				if (this._skipping)
				{
					console.log(`%c[Scheduler] skipping to the next task`, "color: #00AA00");
					state = Scheduler.Event.NEXT;
				}
			}
			// otherwise, we assume that the current task is a scheduler, and we run its tasks until a rendering
			// of the scene is required.
			// note: "if (this._currentTask instanceof Scheduler)" does not work because of CORS...
			else
			{
				// pass the task callback to the scheduler:
				this._currentTask.setTaskCallback(this._taskCallback);

				state = await this._currentTask._runNextTasks();
				if (state === Scheduler.Event.QUIT)
				{
					// if the experiment has not ended, we move onto the next task:
					if (!this._psychoJS.experiment.experimentEnded)
					{
						state = Scheduler.Event.NEXT;
					}
				}
			}

			// if a jump has been scheduled:
			if (this._scheduledJumpTag.length > 0)
			{
				// check whether the current task has the required tag:
				for (const arg of this._currentArgs)
				{
					if ("@tag" in arg)
					{
						const tag = arg["@tag"];
						if (tag === this._scheduledJumpTag)
						{
							// note: -1 since we will do a ++ this._taskIndex in the next iteration of this loop
							this._taskIndex = this._scheduledJumpTaskIndex - 1;
							this._scheduledJumpTag = "";
							break;
						}
					}
				}

				// if a jump has been scheduled, we leave the current task and move onto the next one,
				// even if it is not the one with the required @tag
				state = Scheduler.Event.NEXT;
			}

			// if the current task's return status is FLIP_REPEAT, we will re-run it, otherwise
			// we move onto the next task:
			if (state !== Scheduler.Event.FLIP_REPEAT)
			{
				this._currentTask = undefined;
				this._currentArgs = undefined;
				this._currentName = undefined;
			}
		}

		return state;
	}
}

/**
 * Events.
 *
 * @enum {Symbol}
 * @readonly
 */
Scheduler.Event = {
	/**
	 * Move onto the next task *without* rendering the scene first.
	 */
	NEXT: Symbol.for("NEXT"),

	/**
	 * Render the scene and repeat the task.
	 */
	FLIP_REPEAT: Symbol.for("FLIP_REPEAT"),

	/**
	 * Render the scene and move onto the next task.
	 */
	FLIP_NEXT: Symbol.for("FLIP_NEXT"),

	/**
	 * Quit the scheduler.
	 */
	QUIT: Symbol.for("QUIT"),
};

/**
 * Status.
 *
 * @enum {Symbol}
 * @readonly
 */
Scheduler.Status = {
	/**
	 * The Scheduler is running.
	 */
	RUNNING: Symbol.for("RUNNING"),

	/**
	 * The Scheduler is paused.
	 */
	PAUSED: Symbol.for("PAUSED"),

	/**
	 * The Scheduler is stopped.
	 */
	STOPPED: Symbol.for("STOPPED"),
};
