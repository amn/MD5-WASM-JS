export const { module: WASM_module, instance: WASM_default_module_instance } = await WebAssembly.instantiateStreaming(fetch(new URL("MD5.wasm", import.meta.url))); /// Load the WASM module _and_ create a [default] instance (for convenience, since it can be used in but the most complex application scenarios)

const reserved_header_size = 1024; /// We reserve some memory [of a module instance]; this isn't strictly necessary

/**
	Compute the MD5 digest for a stream of data provided as an iterable of `ArrayBuffer` objects

	Leverages a WebAssembly (WASM) module instance as a computation "driver" (i.e. doing the core of the work). Uses `ArrayBuffer` because that's the closest (as of now) to what can be efficiently used by WASM modules.

	@param {AsyncGenerator<ArrayBuffer>} chunks A generator of data chunks that represents the stream to digest; chunk sizes are expected to be multiples of 64 (bytes) except the last chunk (which will be padded as necessary per MD5 specification); if sizes of chunks other than that of the last chunk are not multiples of 64, the effect of calling this procedure is not defined
	@param {WebAssembly.Instance} [instance] An instance of the MD5 WASM module to utilize; WASM routines are always accessible on and are called using a such instance; an instance, by implication, defines the contigous range of available memory that may be used, in this case when computing a digest; to do computation of multiple digests in parallel, different instances currently must be employed so that different memory is used by each; the underlying WASM module _does_ allow for parallel computation of multiple digests using a single module instance, through being able to address different regions of the same instance memory for each computation; _this_ procedure, however, currently does not manage instance memory in a way where such parallel computation using a single instance, so computations done in parallel by calls to this [asynchronous] procedure must use different WASM module instances, or the effect of such parallel computation, is undefined
	@returns {DataView} The 128 bits of MD5 computation result; returned as a view mapping the result in the buffer where it was originally computed
*/
export async function digest(chunks, { instance = WASM_default_module_instance, signal } = {}) {
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
