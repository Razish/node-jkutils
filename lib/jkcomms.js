#!/usr/bin/env node
// @ts-check

'use strict';

/**
 * protocol support based on:
 * 	dpmaster, doc/techinfo.txt
 * 	id software ftp, idstuff/quake3/docs/server.txt
 */

// third party modules
const debug =		require( 'debug' )( 'comms' );
const dnsSync =		require( 'dns-sync' );

// internal modules
const JKSocket =		require( './jksocket' );
const JKUtils = 		require( './jkutils' );
const Q3MessageParser =	require( './message-parser' );

/**
 * facilitates comms to a server (send/recv well-defined OOB messages)
 * function prefix indicates the flow of traffic:
 * 	ctm_*	client -> master (getservers)
 * 	cts_*	client -> server (getinfo, getstatus)
 */
module.exports = class JKComms {

	/**
	 * @constructor
	 * @param {boolean} [strictMode] error on unexpected response (wrong reply msg or format)
	 */
	constructor( strictMode=true ) {
		this.strictMode = strictMode;
		this.jkSocket = new JKSocket( err => {
			if ( err ) {
				debug( `JKComms::jkSocket err: ${JSON.stringify( err )}` );
				return;
			}
			//NOOP
		} );
	}

	/**
	 * set the default socket behaviour options (allows passing {} as argument)
	 * @param {JKSocketOpts} socketOpts
	 */
	static defaultSocketOpts( socketOpts ) {
		if ( socketOpts.killOnFirstRes === undefined ) {
			socketOpts.killOnFirstRes = false;
		}
		if ( socketOpts.retainSocket === undefined ) {
			socketOpts.retainSocket = true;
		}
	}

	/**
	 * client -> master
	 * @param {object} opts
	 * @param {string} opts.ip
	 * @param {number} opts.port default: ephemeral port https://en.wikipedia.org/wiki/Ephemeral_port
	 * @param {string} opts.protocol default: 26 (Jedi Academy) see protocolStrings
	 * @param {JKSocketOpts} socketOpts
	 * @param {function} callback upon error
	 */
	ctm_getservers( opts, socketOpts, callback ) {
		if ( !callback ) {
			throw new TypeError( 'missing callback' );
		}
		if ( !opts.ip ) {
			throw new TypeError( 'IP must be specified' );
		}
		if ( !opts.port ) {
			throw new TypeError( 'port must be specified' );
		}
		const protocol = opts.protocol || '26';

		opts.ip = dnsSync.resolve( opts.ip );

		// default socket opts
		JKComms.defaultSocketOpts( socketOpts );

		// send `getservers`
		const msg = Buffer.from( `getservers ${protocol}` );
		this.jkSocket.send( { ip: opts.ip, port: opts.port }, socketOpts, msg, (err, res) => {
			if ( err ) {
				debug( `JKComms::cts_getinfo::send err: ${JSON.stringify( err )}` );
				return callback( err, res );
			}

			// verify source address
			if ( res.source.ip !== opts.ip || res.source.port !== opts.port ) {
				if ( this.strictMode ) {
					return callback( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
				else {
					debug( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
			}

			const parser = new Q3MessageParser( res.response );

			const expectedCommand = 'getserversResponse';
			const command = parser.readChars( expectedCommand.length );
			if ( command !== expectedCommand ) {
				if ( this.strictMode ) {
					return callback( `expected \`${expectedCommand}\`, got \`${command}\`` );
				}
				else {
					debug( `expected \`${expectedCommand}\`, got \`${command}\`` );
				}
			}

			// dpmaster starts with: [ '\\' ]
			// masterjk3.ravensoft.com starts with: [ '\n', '\0' ]
			//
			// the last transmission ends with: [ '\\', 'E', 'O', 'T' ]
			// previous transmissions end with	: [ '\\', 'E', 'O', 'F' ]
			// dpmaster also appends this to each msg: [ '\0', '\0', '\0' ]
			//	masterjk3.ravensoft.com does not
			//
			// the first character after the message is always skipped, so masterjk3.ravensoft.com has to be helped
			//	along the way
			const oldOffset = parser.offset;
			do {
				parser.skip();
			} while ( [ '\0', '\n' ].indexOf( parser.msg.readUInt8( parser.offset ) ) !== -1 );
			const newOffset = parser.offset;
			debug( `skipped ${newOffset-oldOffset} bytes from head (offset: ${parser.offset})` );

			// the remainder of the message consists of encoded [ ip(x4), port(x2), '\\' ]
			//	the last chunk will be an EOT or EOF sentinel, optionally followed by null padding
			const servers = [];
			const chunks = parser.splitWithStride( 6, 1 );
			for ( let chunk of chunks ) {
				servers.push( JKUtils.decodeServer( chunk ) );
			}

			// handle EOT/EOF sentinel
			debug( `remaining bytes: ${parser.msg.length - parser.offset}` );
			const sentinel = parser.readLine();
			debug( `sentinel: ${sentinel}` );

			//TODO: maybe just callback once with a full list of servers?
			//	override the timeout if possible?
			// that will benefit EOT vs EOF - we can kill the socket immediately on EOT
			callback( null, servers );
		} );
	}

	/**
	 * client -> server
	 * request basic server game status (name, map, players)
	 * note: server response should include the same challenge
	 * @param {object} opts
	 * @param {string} opts.ip
	 * @param {number} opts.port
	 * @param {string} opts.challenge default: 'jkutils-query'
	 * @param {JKSocketOpts} socketOpts
	 */
	cts_getinfo( opts, socketOpts, callback ) {
		if ( !callback ) {
			throw new TypeError( 'missing callback' );
		}
		if ( !opts.ip ) {
			throw new TypeError( 'IP must be specified' );
		}
		if ( !opts.port ) {
			throw new TypeError( 'port must be specified' );
		}
		const challenge = opts.challenge || 'jkutils-query';

		opts.ip = dnsSync.resolve( opts.ip );

		// default socket opts
		JKComms.defaultSocketOpts( socketOpts );

		// send `getinfo`
		const msg = Buffer.from( `getinfo ${challenge}` );
		this.jkSocket.send( { ip: opts.ip, port: opts.port }, socketOpts, msg, (err, res) => {
			if ( err ) {
				debug( `JKComms::cts_getinfo::send err: ${JSON.stringify( err )}` );
				return callback( err, res );
			}

			// verify source address
			if ( res.source.ip !== opts.ip || res.source.port !== opts.port ) {
				if ( this.strictMode ) {
					return callback( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
				else {
					debug( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
			}

			const parser = new Q3MessageParser( res.response );
			const command = parser.readLine();
			if ( command !== 'infoResponse' ) {
				if ( this.strictMode ) {
					return callback( `expected \`infoResponse\`, got \`${command}\`` );
				}
				else {
					debug( `expected \`infoResponse\`, got \`${command}\`` );
				}
			}

			// process `infoResponse`
			const infoString = parser.readLine();
			const info = JKUtils.parseInfostring( infoString );

			if ( info.challenge !== challenge ) {
				if ( this.strictMode ) {
					return callback( `challenge mismatch: sent \`${challenge}\`, got \`${info.challenge}\`` );
				}
				else {
					debug( `challenge mismatch: sent \`${challenge}\`, got \`${info.challenge}\`` );
				}
			}

			callback( null, { source: res.source, info } );
		} );
	}

	/**
	 * client -> server
	 * request extended server game status (serverstatus, scores)
	 * note: server response should include the same challenge
	 * @param {object} opts
	 * @param {string} opts.ip
	 * @param {number} opts.port
	 * @param {string} opts.challenge default: 'jkutils-query'
	 * @param {JKSocketOpts} socketOpts
	 * @param {function} callback upon error
	 */
	cts_getstatus( opts, socketOpts, callback ) {
		if ( !callback ) {
			throw new TypeError( 'missing callback' );
		}
		if ( !opts.ip ) {
			throw new TypeError( 'IP must be specified' );
		}
		if ( !opts.port ) {
			throw new TypeError( 'port must be specified' );
		}
		const challenge = opts.challenge || 'jkutils-query';

		opts.ip = dnsSync.resolve( opts.ip );

		// default socket opts
		JKComms.defaultSocketOpts( socketOpts );

		// send `getstatus`
		const msg = Buffer.from( `getstatus ${challenge}` );
		this.jkSocket.send( { ip: opts.ip, port: opts.port }, socketOpts, msg, (err, res) => {
			if ( err ) {
				debug( `JKComms::cts_getstatus::send err: ${JSON.stringify( err )}` );
				return callback( err, res );
			}

			// verify source address
			if ( res.source.ip !== opts.ip || res.source.port !== opts.port ) {
				if ( this.strictMode ) {
					return callback( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
				else {
					debug( `response came from \`${res.source.ip}:${res.source.port}\`, expected \`${opts.ip}:${opts.port}\`` );
				}
			}

			const parser = new Q3MessageParser( res.response );
			const command = parser.readLine();
			if ( command !== 'statusResponse' ) {
				if ( this.strictMode ) {
					return callback( `expected \`statusResponse\`, got \`${command}\`` );
				}
				else {
					debug( `expected \`statusResponse\`, got \`${command}\`` );
				}
			}

			// process `statusResponse`
			const infoString = parser.readLine();
			const status = JKUtils.parseInfostring( infoString );

			if ( status.challenge !== challenge ) {
				if ( this.strictMode ) {
					return callback( `challenge mismatch: sent \`${challenge}\`, got \`${status.challenge}\`` );
				}
				else {
					debug( `challenge mismatch: sent \`${challenge}\`, got \`${status.challenge}\`` );
				}
			}

			// parse client scores
			//	format: Score Ping "Name"
			let clients = [];
			let line = null;
			while ( (line = parser.readLine()) ) {
				const matches = /^(?<score>\d+) (?<ping>\d+) "(?<name>.+)"$/.exec( line );
				if ( matches !== null ) {
					clients.push( matches.groups );
				}
			}

			callback( null, { source: res.source, status, clients } );
		} );
	}

};
