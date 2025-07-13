/**
 * Protocols are flow of experiments.
 *
 * @author Alain Pitiot
 * @version 2024.2.0
 * @copyright (c) 2024 Open Science Tools Ltd. (https://opensciencetools.org)
 * @license Distributed under the terms of the MIT License
 */

import {PsychObject} from "../util/PsychObject.js";
import {PsychoJS} from "../core/PsychoJS.js";
import {Keyboard} from "../core/Keyboard.js";
import {ExperimentHandler} from "./ExperimentHandler.js";
import {MonotonicClock} from "../util/index.js";
import * as util from "../util/Util.js";

import A11yDialog from "a11y-dialog";
import * as firebaseApp from "firebase/app";
import * as firebaseRT from "firebase/database";
import * as firebaseAuth from "firebase/auth";


/**
 * <p>Protocols are flow of experiments. They make it possible to schedule experiments and run participants through them.</p>
 *
 * @extends PsychObject
 */
export class Protocol extends PsychObject
{
	/**
	 * Protocol status
	 *
	 * @enum {Symbol}
	 * @readonly
	 */
	static Status = {
		INITIALISED: Symbol.for("INITIALISED"),
		OPENING_SESSION: Symbol.for("OPENING_SESSION"),
		SESSION_OPENED: Symbol.for("SESSION_OPENED"),
		QUERYING_PARTICIPANT: Symbol.for("QUERYING_PARTICIPANT"),
		CLOSING_SESSION: Symbol.for("CLOSING_SESSION"),
		READY: Symbol.for("READY"),
		RUNNING: Symbol.for("RUNNING"),
		COMPLETED: Symbol.for("COMPLETED")
	};

	static Dialog = {
		QUERY_PARTICIPANT_ID: Symbol.for("QUERY_PARTICIPANT_ID"),
		CONFIRM_EXPERIMENT: Symbol.for("CONFIRM_EXPERIMENT"),
		ADMIN_CREDENTIALS: Symbol.for("ADMIN_CREDENTIALS"),
		ADMIN: Symbol.for("ADMIN")
	}

	static Action = {
		QUIT: Symbol.for("QUIT"),
		START_EXPERIMENT: Symbol.for("START_EXPERIMENT"),
		UPLOAD_RESULTS: Symbol.for("UPLOAD_RESULTS")
	}

	get experimentParams()
	{
		return this._protocol.experimentParameters;
	}

	/**
	 * @memberOf module:data
	 * @param {Object} options
	 * @param {module:core.PsychoJS} options.psychoJS 			- the PsychoJS instance
	 * @param {Object.<string, *>} [options.expInfo = {}] 	- additional information, e.g. pilotToken
	 * @param {boolean} [options.autoLog= false] 						- whether to log
	 */
	constructor({psychoJS, expInfo = {}, autoLog = false } = {})
	{
		super(psychoJS);

		this._addAttribute('expInfo', expInfo);
		this._addAttribute('autoLog', autoLog);

		this._protocol = {
			protocolId: undefined,
			protocolName: undefined,
			status: undefined,
			runMode: undefined,
			experimentParameters: {
				showStartDialog: false,
				participantMsg: undefined,
				showEndDialog: false,
				completionUrl: undefined,
				cancellationUrl: undefined,
				autoProgress: undefined
			}
		};
		this._participant = {
			participantId: "",
			participantName: "",
			protocolId: undefined,
			protocolName: undefined,
			protocolModel: undefined,
			coordinates: undefined,
			firebaseRef: undefined
		};
		this._experimentNode = undefined;
		this._firebase = {
			firebaseConfig: undefined,
			customToken: undefined,
			firebaseApp: undefined,
			database: undefined
		};

		this._peer = null;

		// check that a protocol Id is available:
		if (this._psychoJS.serverMsg.has("__protocolId"))
		{
			this._protocolId = this._psychoJS.serverMsg.get("__protocolId");
		}
		else
		{
			this._protocolId = expInfo['protocolId'];
			if (typeof this._protocolId === "undefined")
			{
				throw "the URL is missing a protocolId parameter";
			}
		}
		this._protocol.protocolId = this._protocolId;

		// set participantId, if available:
		if (this._psychoJS.serverMsg.has("__participantId"))
		{
			this._participant.participantId = this._psychoJS.serverMsg.get("__participantId");
		}
		else
		{
			if ("participantId" in expInfo)
			{
				this._participant.participantId = expInfo['participantId'];
			}
			else if ("participantId*" in expInfo)
			{
				this._participant.participantId = expInfo['participantId*'];
			}
		}

		this._isMirror = this._psychoJS.serverMsg.has("__mirror") ? this._psychoJS.serverMsg.get("__mirror") : false;

		this._addAttribute('status', Protocol.Status.INITIALISED);
	}

	/**
	 * @typedef Protocol.OpenProtocolSessionPromise
	 * @property {Object.<string, *>} [error] an error message if we could not open the session
	 */
	/**
	 * Open a session for this protocol on the pavlovia server.
	 *
	 * @returns {Promise<Protocol.OpenProtocolSessionPromise>} the response
	 */
	openSession()
	{
		const response = {
			origin: "Protocol.openSession",
			context: `when opening a session for protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`opening a session for protocol: ${this._protocolId}`);
		this._status = Protocol.Status.OPENING_SESSION;

		// opening a session requires access to the server:
		if (this._psychoJS.config.environment !== ExperimentHandler.Environment.SERVER)
		{
			throw {...response, error: "the experiment has to be run on the server: protocols are not available locally"};
		}

		const self = this;
		return new Promise(async (resolve, reject) =>
		{
			try
			{
				// prepare the request:
				const url = `protocols/${this._protocolId}/sessions`
				const params = {};
				if (this._psychoJS.serverMsg.has("__pilotToken"))
				{
					params.pilotToken = this._psychoJS.serverMsg.get("__pilotToken");
				}

				// submit the request:
				const postResponse = await this._psychoJS.serverManager.queryServer(
					"POST",
					url,
					params,
					"FORM"
				);

				const openSessionResponse = await postResponse.json();

				if (postResponse.status !== 200)
				{
					throw ('error' in openSessionResponse) ? openSessionResponse.error : openSessionResponse;
				}

				self._psychoJS.config.session = {
					sessionToken: openSessionResponse.sessionToken,
					status: "OPEN",
					pilotToken: openSessionResponse.pilotToken
				};
				self._protocol = openSessionResponse.protocol;

				this._status = Protocol.Status.SESSION_OPENED;
				resolve({...response });
			}
			catch (error)
			{
				console.error(error);
				reject({...response, error});
			}
		});
	}

	/**
	 * @typedef Protocol.CloseProtocolSessionPromise
	 * @property {Object.<string, *>} [error] an error message if we could not close the session
	 */
	/**
	 * Close a previously opened session for this protocol on the pavlovia server.
	 *
	 * @returns {Promise<Protocol.CloseProtocolSessionPromise>} the response
	 */
	closeSession(params = {})
	{
		const response = {
			origin: "Protocol.closeSession",
			context: `when closing a previously opened session for protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`closing a previously opened session for protocol: ${this._protocolId}`);
		this._status = Protocol.Status.CLOSING_SESSION;

		// closing a session requires access to the server:
		if (this._psychoJS.config.environment !== ExperimentHandler.Environment.SERVER)
		{
			throw {...response, error: "the experiment has to be run on the server: protocols are not available locally"};
		}

		// check that a session has been previously opened:
		// TODO

		return new Promise(async (resolve, reject) =>
		{
			try
			{
				// prepare the request:
				const url = `protocols/${this._protocolId}/sessions/${this._psychoJS.config.session.sessionToken}`;
				if (this._psychoJS.serverMsg.has("__pilotToken"))
				{
					params.pilotToken = this._psychoJS.serverMsg.get("__pilotToken");
				}

				// submit the request:
				const deleteResponse = await this._psychoJS.serverManager.queryServer(
					"DELETE",
					url,
					params,
					"FORM"
				);

				const closeSessionResponse = await deleteResponse.json();

				if (deleteResponse.status !== 200)
				{
					throw ('error' in closeSessionResponse) ? closeSessionResponse.error : closeSessionResponse;
				}

				this._psychoJS.config.session.status = "CLOSED";

				// this._status = Protocol.Status.SESSION_OPENED;
				resolve({...response });
			}
			catch (error)
			{
				console.error(error);
				reject({...response, error});
			}
		});
	}

	/**
	 * Show a dialog box.
	 *
	 * @param {Protocol.Dialog} name - the name of the dialog
	 * @param {Object} [options={}] - dialog options
	 * @returns {Promise<Protocol.Action>}
	 */
	dialog(name, options = {})
	{
		const response = {
			origin: "Protocol.dialog",
			context: `when showing the dialog: ${Symbol.keyFor(name)}`
		};

		return new Promise(async (resolve, reject) =>
		{
			try
			{
				if (name === Protocol.Dialog.QUERY_PARTICIPANT_ID
					|| name === Protocol.Dialog.CONFIRM_EXPERIMENT
					/*|| name === Protocol.Dialog.ADMIN*/)
				{
					// prepare a dialog box:
					let markup = "<div class='dialog-container' id='experiment-dialog' aria-hidden='true' role='alertdialog'>";
					markup += "<div class='dialog-overlay'></div>";
					markup += "<div class='dialog-content'>";

					// title and close button:
					markup += "<div id='experiment-dialog-title' class='dialog-title'>";
					markup += `  <p>${this._protocol.protocolName}</p>`;
					markup += "  <button id='dialogClose' class='dialog-close' data-a11y-dialog-hide aria-label='Cancel Protocol'>&times;</button>";
					markup += "</div>";

					// everything above the buttons is in a scrollable container:
					markup += "<div class='scrollable-container'>";

					let okButtonLabel = "OK";
					let cancelButtonLabel = "Quit";
					if (name === Protocol.Dialog.QUERY_PARTICIPANT_ID)
					{
						// TODO replace with GUI.js approach and use experimentInfo?
						// TODO if there is already a participantId in the URL then do not ask for it in a textbox!

						markup += "<div class='dialog-panel'>";
						markup += `<div>${this._protocol.experimentParameters.participantMsg}</div>`;
						markup += "</div>";

						// add text box for participant id:
						markup += "<label for='form-input-participantId'>Participant Id*:</label>";
						markup += `<input type='text' name='participantId' id='form-input-participantId' value='${this._participant.participantId}' class='text'>`;

						// add text box for participant name:
						markup += "<label for='form-input-participantName'>Participant Name:</label>";
						markup += `<input type='text' name='participantName' id='form-input-participantName' value='${this._participant.participantName}' class='text'>`;

					}
					else if (name === Protocol.Dialog.CONFIRM_EXPERIMENT)
					{
						// show selected experiment:
						// TODO make it look prettier!
						markup += "<div class='dialog-panel'>";
						markup += `<p>Press the [Run] button to start the next experiment in the protocol, which is:</p><p><strong>${this._experimentNode.name}</strong></p>`;
						markup += "</div>";

						okButtonLabel = "Run";
					}
					else
					{
						// TODO SHOW LICENSE, VERSION NUMBER?
/*
						// banner:
						markup += "<div class='banner'>";
						markup += "  <img class='logo' src='./assets/banner.png' alt='app banner'>";
						markup += "  <div class='version'>";
						markup += `    <div>${this.name}</div><div>Version: ${this._config.application.version}</div><div>${this._config.application.copyright}</div>`;
						markup += "  </div>";
						markup += "</div>";
*/
					}

					markup += "</div>"; // scrollable-container

					// buttons:
					markup += "<div class='dialog-button-group'>";
					markup += `  <button id='dialogCancel' class='dialog-button' aria-label='Cancel'>${cancelButtonLabel}</button>`;
					markup += `  <button id='dialogOK' class='dialog-button' aria-label='OK'>${okButtonLabel}</button>`;
					/*if (name === Protocol.Dialog.START)
					{
						markup += "  <button id='dialogAdmin' class='dialog2-button admin' aria-label='Administration Access'>Admin</button>";
					}*/
					markup += "</div>"; // button-group

/*
					// everything below the buttons is also in a scrollable container:
					markup += "<div class='scrollable-container'>";

					// admin credentials panel, if needed:
					if (name === PsychoJS_Capacitor.Dialog.ADMIN_CREDENTIALS)
					{
						markup += "<hr>";
						markup += "<div class='admin-panel'>";
						markup += "  <div>You need to login to access the administration panel.</div>"
						markup += "  <div class='side-by-side'>";
						markup += `    <label for='adminUsername'>Username:</label><input type='text' name='admin username' id='adminUsername' class='text'>`;
						markup += `    <label for='adminPassword'>Password:</label><input type='password' name='admin password' id='adminPassword' class='text'>`;
						markup += "  </div>";
						markup += "  <div class='button-group'>";
						markup += "    <button id='dialogAdminCancel' class='dialog2-button' aria-label='Cancel Login'>Cancel</button>";
						markup += "    <button id='dialogAdminLogin' class='dialog2-button' aria-label='Administration Login'>Login</button>";
						markup += "  </div>";
						markup += "</div>";
					}

					// admin panel, if needed:
					if (name === PsychoJS_Capacitor.Dialog.ADMIN)
					{
						markup += "<hr>";
						markup += "<div class='admin-panel'>";
						markup += this._showSelectableExperiments();
						markup += "  <div>Press the [Upload Results] button to upload all results stored on the device.";
						markup += "  </div>";
						markup += "  <div id='upload-progress' class='upload-progress'>&nbsp;</div>";
						markup += "  <div class='button-group'>";
						markup += "    <button id='dialogAdminCancel' class='dialog2-button' aria-label='Close Admin'>Close</button>";
						markup += "    <button id='dialogUploadResults' class='dialog2-button' aria-label='Upload Results'>Upload Results</button>";
						markup += "  </div>";
						markup += "</div>";
					}

					markup += "</div>"; // scrollable-container
*/
					markup += "</div></div>";

					// replace root by the markup code:
					const root = document.getElementById("root");
					root.innerHTML = markup;
					root.classList.add("is-ready");

					// init and open the dialog box:
					const dialogDiv = document.getElementById("experiment-dialog");
					this._dialog = new A11yDialog(dialogDiv);
					this._dialog.show();

					// button callbacks:
					if (this._okButton = document.getElementById("dialogOK"))
					{
						this._okButton.onclick = (event) =>
						{
							this._dialog.hide();

							// get the value of ParticipantId:
							if (name === Protocol.Dialog.QUERY_PARTICIPANT_ID)
							{
								let input = document.getElementById("form-input-participantId");
								if (input)
								{
									this._participant.participantId = input.value;
								}
								input = document.getElementById("form-input-participantName");
								if (input)
								{
									this._participant.participantName = input.value;
								}
							}

							resolve({...response, action: Protocol.Action.START_EXPERIMENT});
						};
						this._okButton.focus();
					}

					if (this._cancelButton = document.getElementById("dialogCancel"))
					{
						this._cancelButton.onclick = (event) =>
						{
							this._dialog.hide();

							root.classList.remove("start-experiment");

							resolve({...response, action: Protocol.Action.QUIT});
						};
					}

					if (this._closeButton = document.getElementById("dialogClose"))
					{
						this._closeButton.onclick = (event) =>
						{
							this._dialog.hide();

							root.classList.remove("start-experiment");

							resolve({...response, action: Protocol.Action.QUIT});
						};
					}
/*
					if (this._adminButton = document.getElementById("dialogAdmin"))
					{
						this._adminButton.onclick = async (event) =>
						{
							this._dialog.hide();
							const result = await this.dialog(Protocol.Dialog.ADMIN_CREDENTIALS);
							resolve(result);
						};
					}

					if (this._adminLoginButton = document.getElementById("dialogAdminLogin"))
					{
						this._adminLoginButton.onclick = async (event) =>
						{
							this._dialog.hide();

							// check the admin username and password:
							// TODO

							const result = await this.dialog(Protocol.Dialog.ADMIN);
							resolve(result);
						};
					}

					if (this._adminCancelLoginButton = document.getElementById("dialogAdminCancel"))
					{
						this._adminCancelLoginButton.onclick = async (event) =>
						{
							this._dialog.hide();

							const result = await this.dialog(Protocol.Dialog.START);
							resolve(result);
						};
					}

					if (this._adminUploadResultsButton = document.getElementById("dialogUploadResults"))
					{
						this._adminUploadResultsButton.onclick = async (event) =>
						{
							await this._uploadResults(333539);

							const result = await this.dialog(Protocol.Dialog.ADMIN);
							resolve(result);
						};
					}
*/
				}
			}
			catch (error)
			{
				reject({...response, error});
			}
		});
	}

	/**
	 * Setup the participant, i.e. get information about him or her, connect to Firebase, potentially progress through
	 * the protocol, etc..
	 */
	async setupParticipant()
	{
		const response = {
			origin: "Protocol.setupParticipant",
			context: `when setting up participant: ${this._participant.participantId} for protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`setting up participant: ${this._participant.participantId} for protocol: ${this._protocolId}`);

		// the session must be opened:
		if (this._status !== Protocol.Status.SESSION_OPENED)
		{
			throw {...response, error: "a session has not been opened"};
		}

		// a participantId is required:
		if (typeof this._participant.participantId === "undefined")
		{
			throw {...response, error: "missing participantId"};
		}

		// get information about the participant from the pavlovia server:
		await this._getParticipant(this._participant.participantId);

		// sign-in to the Firebase Realtime database:
		await this.firebaseAuthenticate();

		// setup the two-way communication between Firebase, the scheduler, and the experiment :
		this._setupFirebaseLink();

		// get the current participant coordinates
		// note: this is not necessary any longer, since protocol_manager.getParticipant also returns the coordinates
		// const coordinatesPath = `${this._participant.firebaseRef}/coordinates`;
		// const snapshot = await firebaseRT.get(firebaseRT.ref(this._firebase.database, coordinatesPath));
		// this._participant.coordinates = JSON.parse(snapshot.val());
		// console.log("current participant coordinates:", this._participant.coordinates);

		// check whether we are progressing onto the next experiment:
		if (this._protocol.experimentParameters.autoProgress)
		{
			let doProgress = false;
			const currentNode = this._getNode(this._participant.protocolModel, this._participant.coordinates);

			// if the current node is not an experiment (i.e it is a group), then we need to progress:
			if (currentNode.type !== "EXPERIMENT")
			{
				doProgress = true;
			}
			else
			{
				// if the last session is still open, do not progress:
				if (("session" in currentNode) && (currentNode.session.status === "CLOSED"))
				{
					doProgress = true;
				}
			}

			// move onto the next experiment in the protocol flow, if need be:
			if (doProgress)
			{
				this._participant.coordinates = this._nextExperimentCoordinates(this._participant.coordinates);
			}
		}

		this._experimentNode = this._getNode(this._participant.protocolModel, this._participant.coordinates);
	}

	/**
	 * Run the designated/selected experiment.
	 */
	async run()
	{
		const response = {
			origin: "Protocol.run",
			context: `when running experiment: ${this._experimentNode.name} for participant: ${this._participant.participantId} through protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`running experiment: ${this._experimentNode.name} for participant: ${this._participant.participantId} for protocol: ${this._protocolId}`);

		// the session must be ready:
		if (this._status !== Protocol.Status.READY)
		{
			throw {...response, error: "the session is not ready"};
		}

		try
		{
			// update the participant's entries in the Firebase Realtime database:
			await this._firebaseSet(
				`${this._participant.firebaseRef}/coordinates`,
				JSON.stringify(this._experimentNode.coordinates)
			);
			await this._firebaseSet(
				`${this._participant.firebaseRef}/experiment`,
				this._experimentNode.path
			);
		}
		catch (error)
		{
			console.error(error);
			throw {...response, error};
		}

		// prepare the url:
		let fullUrl = `${this._psychoJS.config.pavlovia.URL}/run/${this._experimentNode.path}`;
		// add the participantId:
		fullUrl += `?__protocolId=${this._protocol.protocolId}&__participantId=${this._participant.participantId}&participantId=${this._participant.participantId}&participantId*=${this._participant.participantId}`;
		// add the experiment's variables:
		for (const key in this._participant.variables)
		{
			const variable = this._participant.variables[key];
			fullUrl += `&${key}${(variable.required)?"*":""}=${variable.value}`;
		}
		// add the session:
		fullUrl += `&session=${this._psychoJS.config.session.sessionToken}`;

		window.location.href = fullUrl;
		// window.open(fullUrl, "_blank");
	}

	/**
	 * Connect a participant to a protocol.
	 */
	async connectParticipant()
	{
		const response = {
			origin: "Protocol.connectParticipant",
			context: `when connecting participant: ${this._participant.participantId} to protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`connecting participant: ${this._participant.participantId} to protocol: ${this._protocolId}`);

		// connecting a participant requires access to the server:
		if (this._psychoJS.config.environment !== ExperimentHandler.Environment.SERVER)
		{
			throw {...response, error: "the experiment has to be run on the server: protocols are not available locally"};
		}

		// it also requires a participantId and a protocolId:
		if (typeof this._protocolId === "undefined")
		{
			throw {...response, error: "missing protocolId"};
		}
		if (typeof this._participant.participantId === "undefined")
		{
			throw {...response, error: "missing participantId"};
		}

		// TODO check status of protocol?

		try
		{
			// submit the request:
			const url = `protocols/${this._protocolId}/participants/${this._participant.participantId}/connect`;
			const putResponse = await this._psychoJS.serverManager.queryServer(
				"PUT",
				url,
				{},
				"JSON"
			);

			const connectParticipantResponse = await putResponse.json();

			if (putResponse.status !== 200)
			{
				throw ('error' in connectParticipantResponse) ? connectParticipantResponse.error : connectParticipantResponse;
			}

			// update the firebase information:
			this._firebase = {
				firebaseConfig: connectParticipantResponse.firebaseConfig,
				customToken: connectParticipantResponse.customToken
			};
			this._participant.firebaseRef = connectParticipantResponse.firebaseRef;
			this._participant.participantRef = connectParticipantResponse.participantRef;

			// sign-in to the Firebase Realtime database:
			await this.firebaseAuthenticate();

			// setup the PsychoJS onComplete & onCancel callbacks, if need be:
			// TODO if there is a call to setRedirectUrls in the PsychoJS experiment code it will override this one, what to do then?
			if (connectParticipantResponse.redirectToProtocol)
			{
				const completionUrl = `${this._psychoJS.config.pavlovia.URL}/run/pavlovia/protocol-2024.2.0/?protocolId=${this._protocolId}&participantId*=${this._participant.participantId}`;
				const cancellationUrl = `${this._psychoJS.config.pavlovia.URL}/run/pavlovia/protocol-2024.2.0/?protocolId=${this._protocolId}&participantId*=${this._participant.participantId}`;
				this._psychoJS.setRedirectUrls(completionUrl, cancellationUrl);
			}

			// setup the Firebase and scheduler two-way communication:
			this._setupFirebaseLink();

			// this._status = Protocol.Status.READY;
		}
		catch (error)
		{
			console.error(error);
		}
	}

	/**
	 * Disconnect the participant from the protocol.
	 */
	async disconnectParticipant()
	{
		const response = {
			origin: "Protocol.disconnectParticipant",
			context: `when disconnecting participant: ${this._participant.participantId} from protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`disconnecting participant: ${this._participant.participantId} from protocol: ${this._protocolId}`);

		// stop streaming the screen capture, if need be:
		this._stopStreamScreen();


		// message the participant to terminate the protocol:
		try
		{
			// update the participant's entries in the Firebase Realtime database:
			await this._firebaseSet(
				`${this._participant.participantRef}/action`,
				{
					cmd: "TERMINATE_PROTOCOL",
					args: {
						protocolId: this._protocolId
					}
				}
			);
		}
		catch (error)
		{
			console.error(error);
			throw {...response, error};
		}
	}

	/**
	 * Setup a two-way communication channel between Firebase, the scheduler, and the experiment.
	 *
	 * @returns {void}
	 * @protected
	 */
	_setupFirebaseLink()
	{
		const response = {
			origin: "Protocol._setupFirebaseLink",
			context: "when setting up a link with the Firebase Realtime database"
		};
		this._psychoJS.logger.debug("when setting up a two-way link with the Firebase Realtime database");

		// act upon the commands received from the server:
		this.onAction( (cmd, args) =>
		{
			console.log("action:", cmd, args);

			const experiment = this._psychoJS.experiment;

			// upload experiment results:
			if (cmd === "UPLOAD_RESULTS")
			{
				experiment.save();
				return;
			}

			// start protocol:
			if (cmd === "RUN")
			{
				this.run();
				return;
			}

			// update participant variables:
			if (cmd === "UPDATE_VARIABLE")
			{
				// TODO check for JSON parsing errors
				const variable = JSON.parse(args);
				this._participant.variables[variable.key] = variable;
				return;
			}

			// restart protocol or experiment:
			if (cmd === "RESTART")
			{
				window.location.reload();
			}

			// quit:
			if (cmd === "QUIT")
			{
				// check for and save orphaned data
				if (experiment.isEntryEmpty())
				{
					experiment.nextEntry();
				}
				this._psychoJS.window.close();
				this._psychoJS.quit({
					// no message since showOK = false
					// message: args,
					isCompleted: false,
					showOK: false,
					closeBrowserTab: true
				});
				return;
			}

			// stream the participant's screen to the protocol console:
			if (cmd === "STREAM_SCREEN")
			{
				this._streamScreen();
				return;
			}

			// start the experiment:
			if (cmd === "START_EXPERIMENT")
			{
				// TODO
				return;
			}

			// mark a participant response as correct or incorrect:
			if (cmd === "MARK_RESPONSE")
			{
				experiment.addData('marker', args);
				return;
			}

			if (cmd === "REWIND_TRIAL")
			{
				const scheduler_args = JSON.parse(args);

				if (this._psychoJS.experiment._loops.length > 0)
				{
					const currentLoop = this._psychoJS.experiment._loops[this._psychoJS.experiment._loops.length - 1];
					currentLoop.rewindTrials(scheduler_args.nb_trials);
				}
			}

			if (cmd === "SKIP_TRIAL")
			{
				const scheduler_args = JSON.parse(args);

				if (this._psychoJS.experiment._loops.length > 0)
				{
					const currentLoop = this._psychoJS.experiment._loops[this._psychoJS.experiment._loops.length - 1];
					currentLoop.skipTrials(scheduler_args.nb_trials);
				}
			}

/* UPDATE: as of 2025-07, we are not dealing with mouse and keyboard mirror event since the mirror approach has been discontinued
			if (this._isMirror)
				{
					if (cmd === "MOUSE_EVENT")
					{
						const mouseEvent = JSON.parse(args);

						// convert the mouse position:
						// TODO deal with the other possible window units:
						if (this._psychoJS.window.units === "height")
						{
							const minSize = Math.min(this._psychoJS.window.size[0], this._psychoJS.window.size[1]);
							mouseEvent.pos = [
								this._psychoJS.window.size[0]/2.0 + mouseEvent.pos[0] * minSize,
								this._psychoJS.window.size[1]/2.0 + mouseEvent.pos[1] * minSize
							];
							// mouseEvent.pos = [
							// 	this._psychoJS.window.size[0]/2.0 + mouseEvent.pos[0] * this._psychoJS.window.size[0],
							// 	this._psychoJS.window.size[1]/2.0 + mouseEvent.pos[1] * this._psychoJS.window.size[1]
							// ];
						}

						this._psychoJS.eventManager.triggerMouseEvent(mouseEvent);
						return;
					}

					if (cmd === "KEYBOARD_EVENT")
					{
						const keyEvent = JSON.parse(args);

						Keyboard.triggerKeyEvent(
							Symbol.for(keyEvent.keyStatus),
							keyEvent.eventKey,
							keyEvent.eventCode,
							keyEvent.eventKeyCode
						);
						return;
					}

					// // start a task
					// if (cmd === "START_TASK")
					// {
					// 	// TODO
					// 	return;
					// }

				}
	*/
		});

		if (!this._isMirror)
		{
/* UPDATE: as of 2025-05, Max Sims does not believe it is necessary to log any of the bellow
			// add a scheduler callback:
			this._psychoJS.scheduler.setTaskCallback( (action, task) =>
			{
				// TODO instead of string, using Symbol.toXXX
				if (action === "START_SCHEDULER")
				{
					this.logMessage('{"event": "START_SCHEDULER"}');
					return;
				}

				if (action === "STOP_SCHEDULER")
				{
					this.logMessage('{"event": "STOP_SCHEDULER"}');

					// empty the mirror message:
					this.logMirrorMessage("");

					return;
				}

				if (action === "START_TASK")
				{
					this.logMessage(`${action} ${task}`);
					// this.logMirrorMessage(`{"event": "START_TASK", "task":"${task}"}`);
					return;
				}

				console.log(action, task);
			});
*/

			// add an experiment data callback:
			if (this._psychoJS.experiment)
			{
				this._psychoJS.experiment.setDataCallback((key, value) =>
				{
					this.logMessage(`{"event":"USER_DATA", "key": "${key}", "value": ${JSON.stringify(value)}`);
				});
				this._psychoJS.setImportAttributesCallback((obj) =>
				{
					if ("ResponseOptions" in obj)
					{
						this.logMessage(JSON.stringify({
							event: "RESPONSE_OPTIONS",
							responseOptions: obj["ResponseOptions"]
						}));
					}
				});
			}

	/* UPDATE: as of 2025-07, we are not sending mouse and keyboard event since the mirror approach has been discontinued
			// add an event manager callback:
			this._psychoJS.eventManager.setEventCallback((keyEvent, mouseInfo) =>
				{
					if (typeof mouseInfo !== "undefined")
					{
						// convert the mouse position:
						let relPos = [0.0, 0.0];

						// TODO deal with the other possible window units:
						if (this._psychoJS.window.units === "height")
						{
							const minSize = Math.min(this._psychoJS.window.size[0], this._psychoJS.window.size[1]);
							relPos = [
								(mouseInfo.pos[0] - this._psychoJS.window.size[0]/2.0) / minSize,
								(mouseInfo.pos[1] - this._psychoJS.window.size[1]/2.0) / minSize
							];
							// relPos = [(mouseInfo.pos[0] - this._psychoJS.window.size[0]/2.0) / this._psychoJS.window.size[0], (mouseInfo.pos[1] - this._psychoJS.window.size[1]/2.0) / this._psychoJS.window.size[1]];
						}

						const prunedMouseInfo = {
							event: "MOUSE_EVENT",
							type: mouseInfo.type,
							pos: relPos,
							wheelRel: mouseInfo.wheelRel,
							buttons: {
								pressed: mouseInfo.buttons.pressed,
								times: mouseInfo.buttons.times
							}
						};

						this.logMirrorMessage(JSON.stringify(prunedMouseInfo));
					}
				}
			);

			// add a Keyboard callback:
			Keyboard.setEventCallback((keyEvent) =>
				{
					this.logMirrorMessage(JSON.stringify(keyEvent));
				}
			);
*/
			// empty the mirror message:
			this.logMirrorMessage("");
		}

	}

	/**
	 * Stream the participant's screen to the protocol console, using PeerJS.
	 * @note This approach does NOT work on mobile devices
	 * @protected
	 */
	async _streamScreen()
	{
		// note: does not work on mobile devices
		// TODO check for errors

		// if the peer is not already set-up, do so:
		if (!this._peer)
		{
			// note: we use the participant's firebase ref as basis for peer ids:
			const strippedRef = this._participant.firebaseRef.split("/")[2].substring(1);
			const participantPeerId = `${strippedRef}-participant`;
			const protocolDashboardPeerId = `${strippedRef}-dashboard`;

			// prepare a PeerJS connection:
			this._peer = new Peer(participantPeerId);
			this._peer.on('open', (id) =>
			{
				this.logMessage(`Prepared a PeerJS connection at id: ${participantPeerId}`);
			});

			// prepare to capture the screen:
			const displayMediaOptions = {
				video: {
					displaySurface: "browser",
				},

				// prefer and include the current tab:
				monitorTypeSurfaces: "include",
				preferCurrentTab: true,
				selfBrowserSurface: "include",

				surfaceSwitching: "exclude",

				// audio: {
				// 	suppressLocalAudioPlayback: false,
				// },
				systemAudio: "include",
			};
			this._screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

			// call the protocol console and stream the user-selected screen/window/tab:
			this._peerCall = this._peer.call(protocolDashboardPeerId, this._screenStream);

			// this._peerConnection = this._peer.connect(protocolDashboardPeerId);
			// this._peerConnection.on("open", () =>
			// {
			// 	this.logMessage("The PeerJS connection to the protocol dashboard is open.");
			//
			// 	this._peerConnection.send("Ahoy there!");
			// });
		}
	}

	/**
	 * Capture a snapshot of PixiJS canvas and send it to the dashboard via logMirrorMessage/Firebase
	 *
	 * @returns {Promise<void>}
	 */
	async shareSnapshot()
	{
		// As of 2025-05-13, this is deactivated. We are now using Microsoft Surface Tablet, the sharing of
		// the patient screen is handled through Zoom.
		return;



		// TODO check for errors
		const window = this._psychoJS.window;

		const takeScreenshot = async (args) =>
		{
			// set the root container position to (0, 0):
			const rootPos = window._rootContainer.position.clone();
			window._rootContainer.position.set(0, 0);

			// window._fullRefresh();

			// take a screenshot as a JPEG image:
			// const img = await window._renderer.plugins.extract.image(window._rootContainer, "image/jpeg", 0.1);
			const img = await window._renderer.plugins.extract.base64(window._rootContainer, "image/jpeg", 0.1);

			// restore the root container position:
			window._rootContainer.position.copyFrom(rootPos);

			// send the image via the Firebase Realtime database:
			await this.logMirrorMessage(img);
		};

		window.callOnFlip(takeScreenshot, {});

		/*
				const url = await window._renderer.plugins.extract.base64(window._rootContainer);
				//const url = await window._renderer.extract.base64(window._stimsContainer); //_rootContainer);
				window._rootContainer.position.copyFrom(rootPos);
				const img = new Image();
				img.src = url;
				document.body.appendChild(img);
		*/
	}

	/**
	 * Stop streaming the screen.
	 *
	 * @returns {Promise<void>}
	 * @private
	 */
	async _stopStreamScreen()
	{
		if (this._screenStream)
		{
			let tracks = this._screenStream.getTracks();
			tracks.forEach((track) => track.stop());
		}

		if (this._peer)
		{
			this._peer.disconnect();
			// this._peer.destroy();
		}
	}

	/**
	 * Setup a callback triggered whenever an action is created.
	 *
	 * @param {Protocol.ActionCallback} actionCallback
	 */
	onAction(actionCallback)
	{
		const response = {
			origin: "Protocol.onAction",
			context: "when setting up an action callback"
		};
		this._psychoJS.logger.debug("setting up an action callback");

		// TODO test that the participant exists and is connected

		try
		{
			const fullPath = `${this._participant.firebaseRef}/action`;
			const self = this;
			let onSetup = true;
			firebaseRT.onValue(
				firebaseRT.ref(self._firebase.database, fullPath),
				(snapshot) =>
				{
					// since the callback is triggered on setup, which we do not want,
					// we do not do anything on setup indeed:
					if (onSetup)
					{
						onSetup = false;
						return;
					}

					const action = snapshot.val();
					if (action)
					{
						actionCallback(action.cmd, action.args);
					}
				}
			);
		}
		catch (error)
		{
			throw {...response, error};
		}
	}

	/**
	 * Authenticate a participant with a Firebase Realtime database, using a custom token.
	 */
	firebaseAuthenticate()
	{
		const response = {
			origin: "Protocol.firebaseAuthenticate",
			context: `when authenticating with a Firebase Realtime database with config: ${JSON.stringify(this._firebase.firebaseConfig)} and custom token: ${this._firebase.customToken}`
		};
		this._psychoJS.logger.debug(`authenticating with a Firebase Realtime database with config: ${JSON.stringify(this._firebase.firebaseConfig)} and custom token: ${this._firebase.customToken}`);

		const self = this;
		return new Promise(async (resolve, reject) =>
		{
			self._firebase.firebaseApp = firebaseApp.initializeApp(self._firebase.firebaseConfig);
			self._firebase.database = firebaseRT.getDatabase(self._firebase.firebaseApp);

			const auth = firebaseAuth.getAuth();
			firebaseAuth.signInWithCustomToken(auth, self._firebase.customToken)
				.then((userCredential) =>
				{
					console.log(userCredential);
					resolve({...response});
				})
				.catch((error) =>
				{
					console.error(error);
					reject({...response, error});
				});
		});
	}

	/**
	 * Log a message for the selected experiment.
	 *
	 * @param msg	- the message to be logged
	 */
	async logMessage(msg)
	{
		const response = {
			origin: "Protocol.logMessage",
			context: `when logging message: "${msg}"`
		};
		this._psychoJS.logger.debug(`log message: "${msg}"`);

		// TODO check that a participant is connected

		try
		{
			const sanitizedPath = this._psychoJS.config.experiment.fullpath.replace("/", "|");
			const fullPath = `${this._participant.firebaseRef}/log/${sanitizedPath}`;
			await firebaseRT.push(
				firebaseRT.ref(this._firebase.database, fullPath),
				{
					'time': MonotonicClock.getDateStr(),
					'msg': msg
				}
			);
		}
		catch(error)
		{
			throw {...response, error};
		}
	}

	/**
	 * Log a mirror message, to be broadcast to the mirror experiment.
	 *
	 * @param msg	- the message to be logged
	 */
	async logMirrorMessage(msg)
	{
		const response = {
			origin: "Protocol.logMirrorMessage",
			context: `when logging mirror message: "${msg}"`
		};
		this._psychoJS.logger.debug(`log mirror message: "${msg.substring(0, 100)}"`);

		// TODO check that a participant is connected

		try
		{
			const sanitizedPath = this._psychoJS.config.experiment.fullpath.replace("/", "|");
			const fullPath = `${this._participant.firebaseRef}/mirror/${sanitizedPath}`;
			await firebaseRT.set(
				firebaseRT.ref(this._firebase.database, fullPath),
				{
					'time': MonotonicClock.getDateStr(),
					'msg': msg
				}
			);
		}
		catch(error)
		{
			throw {...response, error};
		}
	}

	/**
	 * Set the value of a Firebase Realtime database reference.
	 *
	 * @param firebaseRef
	 * @param value
	 * @returns {Promise<unknown>}
	 * @protected
	 */
	async _firebaseSet(firebaseRef, value)
	{
		const response = {
			origin: "Protocol.firebaseSet",
			context: `when setting the Firebase Realtime database reference: ${firebaseRef} to value: ${value}`
		};
		this._psychoJS.logger.debug(`set the Firebase Realtime database reference: ${firebaseRef} to value: ${value}`);

		try
		{
			await firebaseRT.set(
				firebaseRT.ref(this._firebase.database, firebaseRef),
				value
			);
		}
		catch(error)
		{
			throw {...response, error};
		}
	}

	/**
	 * Push a value to a Firebase Realtime database reference.
	 *
	 * @param firebaseRef
	 * @param value
	 * @returns {Promise<unknown>}
	 * @protected
	 */
	async _firebasePush(firebaseRef, value)
	{
		const response = {
			origin: "Protocol.firebasePush",
			context: `when pushing to the Firebase Realtime database reference: ${firebaseRef} the value: ${value}`
		};
		this._psychoJS.logger.debug(`push to the Firebase Realtime database reference: ${firebaseRef} the value: ${value}`);

		try
		{
			await firebaseRT.push(
				firebaseRT.ref(this._firebase.database, firebaseRef),
				value
			);
		}
		catch(error)
		{
			throw {...response, error};
		}
	}

	/**
	 * @typedef Protocol.GetParticipantPromise
	 * @property {Object.<string, *>} [error] an error message if we could not query information
	 * 	about a protocol participant
	 */
	/**
	 * Query information about a protocol participant from the pavlovia server.
	 *
	 * @returns {Promise<Protocol.GetParticipantPromise>} the response
	 */
	_getParticipant()
	{
		const response = {
			origin: "Protocol._getParticipant",
			context: `when querying information about participant: ${this._participant.participantId} registered with protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`querying information about participant: ${this._participant.participantId} registered with protocol: ${this._protocolId}`);
		this._status = Protocol.Status.QUERYING_PARTICIPANT;

		// querying information about a participant requires access to the server:
		if (this._psychoJS.config.environment !== ExperimentHandler.Environment.SERVER)
		{
			throw {...response, error: "the experiment has to be run on the server: protocols are not available locally"};
		}

		return new Promise(async (resolve, reject) =>
		{
			try
			{
				// prepare the request:
				const url = `protocols/${this._protocolId}/participants/${this._participant.participantId}`

				// query the participant information:
				const getResponse = await this._psychoJS.serverManager.queryServer("GET", url, {});

				const queryParticipantResponse = await getResponse.json();

				if (getResponse.status !== 200)
				{
					throw ('error' in queryParticipantResponse) ? queryParticipantResponse.error : queryParticipantResponse;
				}

				this._participant = queryParticipantResponse.participant;
				this._participant.coordinates = JSON.parse(this._participant.coordinates);
				this._firebase = {
					firebaseConfig: queryParticipantResponse.firebaseConfig,
					customToken: queryParticipantResponse.customToken
				};

				this._status = Protocol.Status.READY;
				resolve({...response });
			}
			catch (error)
			{
				console.error(error);
				reject({...response, error});
			}
		});
	}

	/**
	 * Recursively assign coordinates to every node in the protocol flow.
	 *
	 * @param node
	 * @param coordinates
	 * @protected
	 */
	_assignCoordinates(node, coordinates)
	{
		node.coordinates = coordinates;

		if ("nodes" in node)
		{
			for (let c = 0; c < node.nodes.length; ++c)
			{
				this._assignCoordinates(node.nodes[c], [...coordinates, c]);
			}
		}
	}

	/**
	 * Get the coordinates of the next experiment in the protocol flow.
	 *
	 * @param coordinates 						the current coordinates
	 * @param returnFirstExperiment	whether to return the first experiment encountered
	 * @returns {Protocol.node|null}	the next experiment in the protocol flow
	 * @protected
	 */
	_nextExperimentCoordinates(coordinates, returnFirstExperiment = false)
	{
		// get the node corresponding to the given coordinates:
		const node = this._getNode(this._participant.protocolModel, coordinates);

		// if the node is an experiment:
		if (node.type === "EXPERIMENT")
		{
			if (returnFirstExperiment)
			{
				return node.coordinates;
			}

			for (let depth = 1; depth < coordinates.length; ++depth)
			{
				// get the ancestor node:
				const ancestorCoordinates = coordinates.slice(0, coordinates.length - depth);
				const ancestorNode = this._getNode(this._participant.protocolModel, ancestorCoordinates);

				// start at the next sibling, if there is one:
				const childIndex = coordinates[coordinates.length-depth];
				if (ancestorNode.nodes.length > childIndex + 1)
				{
					const siblingCoordinates = [...ancestorCoordinates, childIndex + 1];
					return this._nextExperimentCoordinates(siblingCoordinates, true);
				}
			}

			return null;
		}

		// otherwise, go deeper:
		if (node.nodes.length === 0)
		{
			// note: a non-experiment node should have children, this should never happen
			return null;
		}
		const firstChildNode = node.nodes[0];
		return this._nextExperimentCoordinates(firstChildNode.coordinates, true);
	}

	/**
	 * Get a node from the protocol model.
	 *
	 * @param node
	 * @param coordinates
	 * @param depth
	 * @protected
	 */
	_getNode(node, coordinates, depth = 0)
	{
		// we have reached the node:
		if (node.coordinates.join(",") === coordinates.join(","))
		{
			return node;
		}

		// we need to go deeper:
		else
		{
			return this._getNode(node.nodes[coordinates[depth + 1]], coordinates, depth + 1);
		}
	}

}
