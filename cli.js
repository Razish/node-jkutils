#!/usr/bin/env node
// @ts-check

'use strict';

/**
 * Utilities and helpers for communication with Jedi Academy and Jedi Outcast servers/clients
 * protocol support based on:
 * 	dpmaster, doc/techinfo.txt
 * 	id software ftp, idstuff/quake3/docs/server.txt
 */

// internal modules
const JKComms =		require( './lib/jkcomms' );

let handlers = {
	/**
	 * retrieve list of servers from a master server
	 */
	'getservers': args => {
		if ( args.length !== 2 ) {
			return console.log( 'usage: getservers <ip[:port]>' );
		}

		let addr = args[1].split( ':' );
		let ip = addr[0];
		let port = (addr.length === 2) ? +addr[1] : 29060;

		const comms = new JKComms();
		console.log( `getting servers from ${ip}:${port}` );
		comms.ctm_getservers( { ip, port }, {}, (err, servers) => {
			if ( err ) {
				return console.log( `handlers::getservers err: ${JSON.stringify( err )}` );
			}

			console.log( 'servers:' );
			for ( let server of servers ) {
				console.log( `\t${JSON.stringify( server )}` );
			}
		} );
	},

	/**
	 * chains getinfo -> infoResponse -> getstatus -> statusResponse
	 * this little dance is necessary to inform some strict firewalls that "we're really real ^_^"
	 * ...like port knocking!
	 */
	'serverstatus': args => {
		if ( args.length !== 2 ) {
			return console.log( 'usage: serverstatus <ip[:port]>' );
		}

		let addr = args[1].split( ':' );
		let ip = addr[0];
		let port = (addr.length === 2) ? +addr[1] : 29070;

		const comms = new JKComms();
		console.log( `getting serverstatus for ${ip}:${port}` );
		comms.cts_getinfo( { ip, port }, { killOnFirstRes: true }, (err, info) => {
			if ( err ) {
				return console.log( `handlers::serverstatus err: ${JSON.stringify( err )}` );
			}
			console.log( `info: ${JSON.stringify( info, null, '\t' )}` );

			comms.cts_getstatus( { ip, port }, { retainSocket: false, killOnFirstRes: true }, (err, status) => {
				if ( err ) {
					return console.log( `handlers::serverstatus err: ${JSON.stringify( err )}` );
				}
				console.log( `status: ${JSON.stringify( status, null, '\t' )}` );
			} );
		} );
	},

	/**
	 * query all servers that are broadcasting to this master server
	 * chains getservers -> getserversResponse -> getinfo -> infoResponse -> getstatus -> statusResponse
	 */
	'feed': args => {
		if ( args.length !== 2 ) {
			return console.log( 'usage: feed <ip[:port]>' );
		}

		let addr = args[1].split( ':' );
		let ip = addr[0];
		let port = (addr.length === 2) ? +addr[1] : 29060;

		const comms = new JKComms();
		console.log( `getting servers from ${ip}:${port}` );
		comms.ctm_getservers( { ip, port }, {}, (err, servers) => {
			if ( err ) {
				return console.log( `handlers::getservers err: ${JSON.stringify( err )}` );
			}

			for ( let server of servers ) {
				process.nextTick( server => {
					const comms2 = new JKComms();

					const dest = { ip: server.ip, port: server.port };
					comms2.cts_getinfo( dest, { killOnFirstRes: true }, (err, info) => {
						if ( err ) {
							return console.log( `handlers::serverstatus err: ${JSON.stringify( err )}` );
						}

						process.nextTick( info => {
							const dest = { ip: info.source.ip, port: info.source.port };
							comms2.cts_getstatus( dest, { retainSocket: false, killOnFirstRes: true }, (err, status) => {
								if ( err ) {
									return console.log( `handlers::serverstatus err: ${JSON.stringify( err )}` );
								}
								console.log( `info: ${JSON.stringify( info, null, '\t' )}` );
								console.log( `status: ${JSON.stringify( status, null, '\t' )}` );
							} );
						}, info );
					} );
				}, server );
			}
		} );
	},
};

if ( module.parent === null ) {
	if ( process.stdout.isTTY ) {
		console.log( 'running jkutils from cli' );
	}

	// cut off the process and script name
	let args = process.argv.slice( 2 );

	let handlerFunc = handlers[args[0]];
	if ( !handlerFunc ) {
		console.log( `please specify a command:\n  ${Object.keys( handlers ).join( '\n  ' )}` );
		process.exit( 1 );
	}
	handlerFunc( args );
}
