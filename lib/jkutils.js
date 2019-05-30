#!/usr/bin/env node
// @ts-check

'use strict';

/**
 * Utilities and helpers for communication with Jedi Academy and Jedi Outcast servers/clients
 */

module.exports = {

	protocolStrings: {
		'DarkPlaces': 'DP',
		'QuakeArena-1': 'Q3A',
		'Wolfenstein-1': 'RtCW',
		'EnemyTerritory-1': 'WoET',
	},

	protocolNumbers: {
		'15': 'Jedi Outcast 1.02',
		'16': 'Jedi Outcast 1.04',
		'26': 'Jedi Academy 1.01',
	},

	//TODO: swap '%' for '.' in net traffic
	badCharacters: [ '\\', '/', ';', '"', '%' ],

	oobPrefix: Buffer.from( [0xFF, 0xFF, 0xFF, 0xFF] ),

	// strip Q3 colour codes from a string
	stripColours: s =>
		s.replace( /\^[0-9]/g, '' ),

	/**
	 * parse out a q3 infostring
	 * @param {string} info in either form:
	 * 	- "k1\v1\k2\v2"
	 * 	- "\k1\v1\k2\v2"
	 * @returns {Object}
	 */

	parseInfostring: info => {
		if ( info[0] === '\\' ) {
			info = info.slice( 1 );
		}

		const toks = info.split( '\\' );

		// this accounts for invalid key/value pairs
		const pairs = {};
		for ( let i = 0; i < toks.length - 1; i += 2 ) {
			pairs[toks[i].toLowerCase()] = toks[i + 1];
		}
		return pairs;
	},

	/** encode q3 bit representation of a server (ip+port)
	 * @param {string} ip
	 * @param {number} port
	 * @returns {Buffer}
	 */
	encodeServer: (ip, port) => {
		const buffer = Buffer.alloc( 6, 0, 'binary' );
		let offset = 0;

		const octets = ip.split( '.' ).map( n => +n );
		buffer.writeUInt32BE( (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | (octets[3]), offset );
		offset += 4;

		buffer.writeUInt16BE( (port >> 8) | (port & 0xFF), offset );
		offset += 2;

		return buffer;
	},

	/** encode q3 bit representation of a server (ip+port)
	 * @param {Buffer} buffer
	 * @param {number} port
	 * @returns {Object}
	 */
	// returns a { [] ip, Number port } from a Buffer
	decodeServer: buffer => ({
		ip: buffer.slice( 0, 4 ).join( '.' ),
		port: buffer.readUInt16BE( 4 ),
	}),

};
