export const aligned_chunk_size = size => ((size & ~(64 - 1)) || 64); /// Round down `size` to the nearest multiple of 64 that is larger than or equal to 64; see `digest` below

export const WASM_module = await WebAssembly.compileStreaming(fetch(new URL("MD5.wasm", import.meta.url))); /// The module is loaded from where this module is (a kind of incentive to keep the two together)

const reserved_header_size = 1024; /// We reserve some memory [of a module instance]; this isn't strictly necessary

/**
	Compute the MD5 digest for a stream of data provided as an iterable of `ArrayBuffer` objects

	Leverages a WebAssembly (WASM) module instance as a computation "driver" (i.e. doing the core of the work). Uses `ArrayBuffer` because that's the closest (as of now) to what can be efficiently used by WASM modules.

	@param {AsyncGenerator<ArrayBuffer>} chunks A generator of data chunks that represents the stream to digest; chunk sizes are expected to be multiples of 64 (bytes) except the last chunk (which will be padded as necessary per MD5 specification); if sizes of chunks other than that of the last chunk are not multiples of 64, the effect of calling this procedure is not defined
	@param {WebAssembly.Instance} [instance] An instance of the MD5 WASM module to utilize; WASM routines are always accessible on and are called using a such instance; an instance, by implication, defines the contigous range of available memory that may be used, in this case when computing a digest; to do computation of multiple digests in parallel, different instances currently must be employed so that different memory is used by each; the underlying WASM module _does_ allow for parallel computation of multiple digests using a single module instance, through being able to address different regions of the same instance memory for each computation; _this_ procedure, however, currently does not manage instance memory in a way where such parallel computation using a single instance, so computations done in parallel by calls to this [asynchronous] procedure must use different WASM module instances, or the effect of such parallel computation, is undefined
	@returns {DataView} The 128 bits of MD5 computation result; returned as a view mapping the result in the buffer where it was originally computed
*/
export async function digest(chunks, { instance, signal } = {}) {
	if(instance === undefined) instance = await WASM_module_instance_pool.acquire();
	try {
		const o_context = reserved_header_size, o_input = o_context + 24; /// Establish where in instance memory we will be accessing what (partially mandated by the WASM module)
		const { memory, pad, start, update } = instance.exports; /// WASM instance memory and the actual "driver" routines for computation
		let input_memory_view = new Uint8Array(memory.buffer, o_input); /// Chunks of data are written sequentially for processing to this mapped portion of WASM instance memory
		start(o_context); /// Initialization is [expected to be] done by the WASM module for every object to be digested
		let n_bytes_to_pad = 0; /// This amount of bytes will be padded in accordance with the MD5 algorithm; per the algorithm, padding is always done, even when there are zero bytes to pad
		for await(const chunk of chunks) {
			if(signal?.aborted) throw new DOMException(signal.reason, "AbortError");
			const n_extra_memory_bytes_required = chunk.byteLength + 64 - (memory.buffer.byteLength - o_input); /// 64 bytes extra for unaligned [final] chunk that will be padded
			if(n_extra_memory_bytes_required > 0) { /// Do we need to expand instance memory to accomodate processing of this chunk?
				memory.grow(Math.ceil(n_extra_memory_bytes_required / 65536)); /// Memory is grown by a number of 64KiB blocks
				input_memory_view = new Uint8Array(memory.buffer, o_input); /// A view has the same size it was created with, so when memory is expanded, another view must be created with the new expanded length; additionally, after memory is expanded it may refer to an entirely different buffer so the old buffer may be invalid
			}
			input_memory_view.set(new Uint8Array(chunk)); /// Copy chunk into WASM module instance memory to make the chunk accessible by WASM; unfortunately, no zero-copy API(s) available to leverage (as of now) :/
			if(chunk.byteLength % 64) { /// We assume an unaligned chunk is the _last_ chunk in the series
				n_bytes_to_pad = chunk.byteLength;
				break;
			}
			update(o_input, chunk.byteLength, o_context); /// Update MD5 digest using [copied] chunk data
		}
		update(o_input, pad(o_input, n_bytes_to_pad, o_context), o_context);
		return new DataView(memory.buffer, o_context, 16); /// Starting at `context.offset` bytes of instance's memory there's 16 bytes that are the accumulated digest
	}
	finally {
		WASM_module_instance_pool.release(instance);
	}
}

/**
	A class of workers for offloading the digesting to.
*/
export class Worker extends globalThis.Worker {
	constructor() {
		super(new URL("MD5.worker.js", import.meta.url), { type: "module" });
	}
	/**
	 * Invoke the MD5 computation procedure on a dedicated thread.
	 *
	 * This "offloads" the call to the worker context (with its own script execution thread), in other words this is a form of a remote procedure call (RPC).
	 *
	 * The `transferable` method on the worker MUST be defined for this method to work. The former is expected to return the set of [transferable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) objects related to the `input` argument passed by message to the worker as part of RPC mechanism. Depending on the type of `input`, a set of transferables may _have to be_ returned -- `ReadableStream` objects, for example, are _not_ clonable but permit and thus mandate transferring (so returning `[]` won't do), meaning the set of transferable objects that are to be returned by the `transferables` method passed a `ReadableStream` as `input`, must be `[ input ]`. Conversely, `Blob` objects (for the sake of example ignoring the fact that the `digest` routine cannot work with `Blob` for input since iteration [of chunks] isn't defined for the latter type), _are_ clonable but _not_ transferable -- the `transferables` method _must_ return an empty set (`[]`) for these. Requiring a `transferables` method allows this method to not have to assume a given set of types of input it may support, deferring instead to the caller to effectively define _how_ to pass input by message. Ideally, the native message passing API would encapsulate these details without needing the developer to be helping out, but that is a whole different can of worms. See also https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm.
	 *
	 * @param {Iterable<ArrayBuffer>|AsyncIterable<ArrayBuffer>} input The data to compute the digest for; the object _must_ be transferrable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects); effectively passed as-is to the `digest` procedure in this module -- requirements that apply for the `chunks` parameter to the latter, also apply to this parameter
	 * @param {AbortSignal} [signal} A signal that may be used to abort the digesting process
	 */
	async digest(input, { signal } = {}) {
		signal?.throwIfAborted(); /// Reject immediately if aborted already, and to ensure we can expect an "abort" event otherwise; see [bullet point 4 in the list of steps specifying the `fetch` method of the Fetch API](https://fetch.spec.whatwg.org/#fetch-method) which sets a kind of precedent for how to deal with cases of the well-known `signal` argument being in the "aborted" state already at the time of the procedure call wherein it is passed
		const channel = new MessageChannel(); /// Create a bi-directional channel to use as RPC for the worker to communicate back the result of digesting the blob
		const result_promise = new Promise((resolve, reject) => { channel.port1.onmessage = ev => (Error.isError(ev.data) ? reject : resolve)(ev.data); }); /// Create the promise that resolves with the result or rejects with the error (if the RPC threw an exception)
		signal?.addEventListener("abort", ev => channel.port1.postMessage(ev.target.reason));
		signal = !!signal; /// We cannot send the signal with `postMessage` as it's neither clonable nor transferable, so we send a corresponding "make the call abortable" flag which the message receiver is expected to use to allow us to effectively abort the [potentially lengthy] RPC
		this.postMessage({ input, signal }, [ ...this.transferables(input), channel.port2 ]); /// RPC-call the `digest` procedure -- a worker is expected to execute it
		return result_promise;
	}
}

const WASM_module_instance_pool = new (class WASMModuleInstancePool {
	constructor() {
		this.available = [];
		this.acquired = new Set();
	}
	async acquire() {
		const instance = this.available.pop() || (await WebAssembly.instantiate(WASM_module));
		this.acquired.add(instance);
		return instance;
	}
	release(instance) {
		if(this.acquired.delete(instance)) {
			this.available.push(instance);
		}
	}
})();
