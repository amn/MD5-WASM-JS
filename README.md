This is an ECMAScript module for MD5 computation using WebAssembly.

In simpler terms: it's a JavaScript file that allows you to compute [MD5](http://en.wikipedia.org/wiki/MD5) digests in your Web browser, "very fast".

# Requirements

This module depends on a WebAssembly (WASM) module for actual MD5 computation. [A repository tracking a suitable implementation, is available](http://github.com/amn/MD5.wasm) and is tracked by this repository automatically. By itself, this module is just a "frontend" to the former.

Obviously, your script host that will load this module, is expected to contain a WebAssembly platform.

# Installation

1. Clone this repository (`git clone`)
2. Change to the directory where you expect your Web server to serve `MD5.js` and `MD5.wasm` over HTTP
3. Utilize the provided [`makefile`](https://www.gnu.org/software/make):

```
make -f ~/path/to/the/makefile
```

# Usage

The `MD5.js` module is designed to be [imported](http://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-imports), e.g. with a statement like `import "./MD5.js";`.

It currently exports a single procedure for [MD5](http://en.wikipedia.org/wiki/MD5) computation: `digest`. The procedure is designed to support computing of a digest of any kind of data that can be represented by object that [iterates](http://tc39.es/ecma262/#sec-iteration) over `ArrayBuffer` objects (in context of the computation referred to as "chunks" [of the data]). Put another way, if your data can be represented by an *iterable* series of `ArrayBuffer` objects, the `digest` procedure can use it. As should be familiar, every `Array` is iterable, and so is every *iterator* object returned by a [generator function](http://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-generator-objects); otherwise any kind of object of your design will do as long as it conforms to the iterator protocol. The rule of thumb for determining if an object is suitable here, is: if it can be used in a `for await(... of ...)` or `for(... of ...)` loop, it is suitable for `digest`.

# Examples of use

Below is a function that calls the `digest` procedure to compute a digest of a potentially very large (for computer memory) blob of data it is passed, typically a large file "on disk". Because computation necessarily blocks the execution of the script, "chunking" the file into sufficiently large chunks will have the effect of suspending execution in a manner where the user agent won't tend to related elements, like interactive elements of the Web page when attempted clicked or otherwise interacted with by the user. For this reason, the function computes chunks of such size as to always keep a minimum "frame rate" -- adjusting the chunk size according to how fast or slow the last chunk was assumed to be processed. With a preset ideal processing time, arbitrarily large streams of data can be processed by a single script execution thread without aforementioned detriment to things like UI elements etc.

```javascript
import { digest } from "./MD5.js";

/**
	Return a generator vending chunks of a file

	@param {Blob} blob A file (or blob) to vend chunks of
	@param {Function} get_chunk_size A function that will be called for each chunk to vend, expected to return the desired size of the chunk
	@param {Function} map A function that is expected to return the object to vend given a chunk which originally is always a blob; for convenience when wanting to vend something else than blobs; e.g. if you want to vend the original chunk, `map` would be something like `chunk => chunk` (identity function); `map` can also return a `Promise` which will have `chunked` vend the value the promise resolves to
	@param {Number} [offset] An offset into the file data where the first chunk will start at
	@returns {Generator} An iterable object created to vend chunks of the file
*/
function* chunked(blob, get_chunk_size, { map, offset = 0 } = {}) {
	for(let chunk; offset < blob.size; offset += chunk.size) {
		yield map(chunk = blob.slice(offset, offset + get_chunk_size()));
	}
}

/**
	Compute an MD5 digest of a file in variable-sized chunks, reporting progress

	@param {Blob} file A file (or blob) to compute the digest for
	@param {HTMLProgressElement} A `progress` HTML element that will be updated to track progress of the computation
	@param {Number} ideal_chunk_process_time The time period value (in milliseconds) we ideally want chunks to complete processing, in order to retain interactivity; since most user agents strive to retain 60 frames per second (FPS), then that's our default; you can probably retain interactivity even with a period of 100-200 milliseconds (10-5 FPS), which will positively affect speed of total computation, but any larger values than that will effectively bring interactivity to a halt
	@param {Number} chunk_size The [initial] chunk size to use; since for the first chunk we have no basis for measurements to adjust the size, we must assume an initial value; 1 megabyte (2 to the 10th power) should be very modest and more than acceptable on most modern computers, all with rates for processing a single chunk being anywhere between 50 to 500MB/s; the chunk size will anyhow be adjusted to be as big as possible while allowing interactivity specified by `ideal_chunk_processing_time`
	@returns {DataView} A view onto the 16 bytes that make up the digest result
*/
async function compute_MD5_of_a_file(file, progress, { ideal_chunk_process_time = 1000 / 60, chunk_size = 2 ** 20 } = {}) {
	let mark;
	const result = await digest(chunked(file, () => {
		const now = performance.now();
		if(mark) {
			progress.value += chunk_size; /// Assume last chunk was digested so update the progress bar
			const chunk_process_time = now - mark; /// The closest we may get to computing the processing time (in milliseconds) of the last vended chunk
			chunk_size = ((chunk_size * ideal_chunk_process_time / chunk_process_time) & ~(512 - 1)) || 512; /// Align the value on 512 bytes and ensure it's 512 bytes minimum; required by `digest`
		}
		mark = now;
		return chunk_size;
	}, { map: blob => blob.arrayBuffer() }));
	progress.value += chunk_size; /// After `digest` has completed, progress was only updated before the last chunk was vended, so update it for the last time (should correctly become a 100% value)
	return result;
}
```

Different kinds of data will probably warrant a slightly or very different approach.
