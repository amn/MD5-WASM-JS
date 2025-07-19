/**
 * A script for initializing an MD5 computation worker.
 *
 * The script is written to be suitable to be passed (by the URL) to the `Worker` constructor.
 *
 * It sets up a remote procedure call (RPC) "bridge" for a script to hand off execution of the MD5 computation procedure implemented by `./MD5.js`, to a dedicated thread (implied by the worker).
 */

import { digest } from "./MD5.js";

Object.assign(globalThis, {
	async onmessage(ev) { /// An event handler that implements a remote procedure call (RPC) for `digest`; invoked by the UA automatically with every call to the worker's `postMessage` method (e.g. in a page context)
		const [ port ] = ev.ports; /// The port is on this end of a 2-port channel created to transfer the return value of the RPC
		port.postMessage(await digest(ev.data)); /// Compute the digest and return it (the party that sent the RPC message will receive the value on the other port of the channel)
	}
});
