#!/usr/bin/env node
// @ts-check

'use strict';

/**
 * Q3 OOB message parser
 */

// third party modules
const buffer_split =	require( 'buffer-split' );

module.exports = class Q3MessageParser {

	/**
	 * @constructor
	 * @param {Buffer} msg q3 encoded net message
	 * @param {boolean} [validateHeader] whether to check for msg prefix and advance pointer upon initialisation
	 */
	constructor( msg, validateHeader=true ) {
		this.msg = msg;
		this.offset = 0;
		if ( validateHeader ) {
			const marker = this.msg.readUInt32LE( this.offset );
			this.offset += 4;
			if ( marker !== 0xFFFFFFFF ) {
				throw new Error( `Q3MessageParser: missing start marker, received ${marker}` );
			}
		}
	}

	/**
	 * parse rest of message into array of strings
	 * note: does NOT split on '\\' - use jkutils.parseInfostring
	 * @param {boolean} [allowCRLF] whether to split on line control characters
	 * @returns array of chunks
	 */
	parseStringArgs( allowCRLF=false ) {
		//TODO: rewrite with buffer_split
		const args = this.msg.toString( 'ascii', this.offset ) // to ASCII
			.split( allowCRLF ? /[ \0]/ : /[ \n\r\0]/ ); // split on delimiters/special chars
		this.offset += args.reduce( (s, arg) => s + arg.length + 1, 0 ) // +1 for space between args
			- 1; // no space after last arg
		return args;
	}

	/**
	 * reads a string from the current position up until the next linefeed (or remainder of message)
	 * @returns string
	 */
	readLine() {
		//FIXME: check if toString mutates this.msg???
		const str = this.msg.toString( 'ascii', this.offset ); // to ASCII
		const nextLineIdx = str.indexOf( '\n' );
		if ( nextLineIdx !== -1 ) {
			this.offset += nextLineIdx + 1;
			return str.slice( 0, nextLineIdx );
		}
		//FIXME: test this sets the offset correctly
		this.offset += str.length;
		return str;
	}

	/**
	 * reads a string from the current position up until numBytes (or remainder of message)
	 * @param {number} numBytes how many bytes to read
	 * @returns string
	 */
	readChars( numBytes ) {
		//TODO: handle if ( this.offset + numBytes > this.msg.length )
		const str = this.msg.slice( this.offset, this.offset + numBytes ).toString( 'ascii' );
		this.offset += numBytes;
		return str;
	}

	/**
	 * split a buffer from the current read position to the end
	 * @param {string} delimiter ???
	 * @param {boolean} [keepDelimiter] don't strip the delimiter (appends to previous chunk)
	 * @param {number} [maxBytes] maximum number of bytes to consider splitting
	 * @returns array of chunks
	 */
	split( delimiter, keepDelimiter=false, maxBytes=0 ) {
		//FIXME: better to use Buffer.from( this.msg, this.offset )?
		const toSplit = this.msg.slice( this.offset, (maxBytes === 0) ? undefined : maxBytes );
		const delim = Buffer.from( delimiter, 'ascii' );
		return buffer_split( toSplit, delim, keepDelimiter );
	}

	/**
	 *
	 * @param {number} [chunkSize] size of each chunk to split the msg into
	 * @param {number} [stride] how many bytes to skip between chunks
	 * @param {number} [numChunks] maximum number of chunks to split out (0 = unlimited)
	 * @returns array of chunks
	 */
	splitWithStride( chunkSize=1, stride=1, numChunks=0 ) {
		const chunks = [];
		while ( (this.offset + chunkSize) < this.msg.length
			&& (!numChunks || chunks.length < numChunks) )
		{
			chunks.push( this.msg.slice( this.offset, this.offset + chunkSize ) );
			this.offset += chunkSize;
			this.offset += stride;
		}
		return chunks;
	}

	/**
	 * @param {number} [numBytes] how many bytes to skip (default: 1)
	 * @returns true if there are more bytes to read after skipping, false if skipping would leave us with 0 bytes
	 */
	skip( numBytes=1 ) {
		if ( this.offset + numBytes >= this.msg.length ) {
			this.offset = this.msg.length;
			return false;
		}
		this.offset += numBytes;
		return true;
	}

	/**
	 * @returns how many bytes are available to read
	 */
	remainingBytes() {
		return this.msg.length - this.offset;
	}

};
