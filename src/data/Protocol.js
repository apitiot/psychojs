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
import {ExperimentHandler} from "./ExperimentHandler";
import A11yDialog from "a11y-dialog";


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
	 * @param {module:core.PsychoJS} options.psychoJS 						- the PsychoJS instance
	 * @param {Object.<string, *>} [options.experimentInfo = {}] 	- additional information, e.g. pilotToken
	 * @param {boolean} [options.autoLog= false] 									- whether to log
	 */
	constructor({psychoJS, name, experimentInfo = {}, autoLog = false } = {})
	{
		super(psychoJS);

		this._addAttribute('name', name);
		this._addAttribute('experimentInfo', experimentInfo);
		this._addAttribute('autoLog', autoLog);

		// check that a protocol Id is available:
		this._protocolId = experimentInfo['protocolId'];
		if (typeof this._protocolId === "undefined")
		{
			throw "the URL is missing a protocolId parameter";
		}

		this._protocol = {
			status: undefined,
			runMode: undefined,
			experimentParameters: undefined
		};
		this._participant = {
			participantId: ""
		};

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

				// open a protocol session:
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
					/*|| name === Protocol.Dialog.ADMIN_CREDENTIALS
					|| name === Protocol.Dialog.ADMIN*/)
				{
					// prepare a dialog box:
					let markup = "<div class='dialog-container' id='experiment-dialog' aria-hidden='true' role='alertdialog'>";
					markup += "<div class='dialog-overlay'></div>";
					markup += "<div class='dialog-content'>";

					// title and close button:
					markup += "<div id='experiment-dialog-title' class='dialog-title'>";
					markup += `  <p>${this.name}</p>`;
					markup += "  <button id='dialogClose' class='dialog-close' data-a11y-dialog-hide aria-label='Cancel Protocol'>&times;</button>";
					markup += "</div>";

					// everything above the buttons is in a scrollable container:
					markup += "<div class='scrollable-container'>";

					if (name === Protocol.Dialog.QUERY_PARTICIPANT_ID)
					{
						// TODO replace with GUI.js approach and use experimentInfo?
						// TODO if there is already a participantId in the URL then do not ask for it in a textbox!

						// add text box for participant id:
						markup += "<label for='form-input-participantId'>participant Id*:</label>";
						markup += `<input type='text' name='participantId' id='form-input-participantId' value='${this._participant.participantId}' class='text'>`;
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
					markup += "<hr>";
					markup += "<div class='dialog-button-group'>";
					markup += "  <button id='dialogCancel' class='dialog-button' aria-label='Cancel'>Cancel</button>";
					markup += "  <button id='dialogOK' class='dialog-button' aria-label='OK'>OK</button>";
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
								const input = document.getElementById("form-input-participantId");
								if (input)
								{
									this._participant.participantId = input.value;
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
	 * Progress a participant through the protocol flow.
	 */
	async progress()
	{
		const response = {
			origin: "Protocol.progress",
			context: `when progressing the participant: ${this._participant.participantId} through protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`progressing participant: ${this._participant.participantId} for protocol: ${this._protocolId}`);

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

		// move onto the next experiment in the protocol flow:
		// TODO update the below:
		// this._participantCoordinates = this._nextExperimentCoordinates([0]);
		// this._experimentNode = this._getNode(this._protocol.flow, this._participantCoordinates);
	}

	/**
	 * @typedef Protocol.GetParticipantPromise
	 * @property {Object.<string, *>} [error] an error message if we could not query information
	 * 	about a protocol participant
	 */
	/**
	 * query information about a protocol participant from the pavlovia server.
	 *
	 * @param {string} participantId											- the participant Id
	 * @returns {Promise<Protocol.GetParticipantPromise>} the response
	 */
	_getParticipant(participantId)
	{
		const response = {
			origin: "Protocol._getParticipant",
			context: `when querying information about participant: ${participantId} from protocol: ${this._protocolId}`
		};
		this._psychoJS.logger.debug(`querying information about participant: ${participantId} from protocol: ${this._protocolId}`);
		this._status = Protocol.Status.QUERYING_PARTICIPANT;

		// querying information about a participant requires access to the server:
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
				const url = `protocols/${this._protocolId}/participants`
				const data = {
					participantId
				};

				// query the participant information:
				const postResponse = await this._psychoJS.serverManager.queryServer(
					"PUT",
					url,
					data,
					"JSON"
				);

				const queryParticipantResponse = await postResponse.json();

				if (postResponse.status !== 200)
				{
					throw ('error' in queryParticipantResponse) ? queryParticipantResponse.error : queryParticipantResponse;
				}

				self._participant = queryParticipantResponse.participant;
				self._psychoJS.config.firebase = {
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
	 * Get the coordinates of the next experiment in the protocol flow.
	 *
	 * @param coordinates 						- the current coordinates
	 * @param returnFirstExperiment		- whether to return the first experiment encountered
	 * @returns {Protocol.node|null}	the next experiment in the protocol flow for the given participant
	 * @protected
	 */
	_nextExperimentCoordinates(coordinates, returnFirstExperiment = false)
	{
		// get the node corresponding to the parent of the coordinates:
		const node = this._getNode(this._protocol.flow, coordinates);

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
				const ancestorNode = this._getNode(this._protocol.flow, ancestorCoordinates);

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

		// otherwise:
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
