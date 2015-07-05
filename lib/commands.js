/* global atom */
var Q = require('q');
var spawn = require('child_process').spawn;

module.exports = Commands;

function Commands() {
	var runCommand = function(command, args) {
		var buildProcess = spawn(command, args, {
			cwd: atom.project.rootDirectories[0].path
		});

		// TODO: Remove the colors

		return buildProcess;
	};

	var runTask = function(command, args) {
		var defer = Q.defer();

		var buildProcess = runCommand(command, args);

		var allData = null;
		buildProcess.stdout.on('data', function(data) {
			if(!allData) {
				allData = data;
			}
			else {
				// Wait till converting the buffer to a string. This is faster.
				allData = Buffer.concat([allData, data]);
			}
		});

		buildProcess.on('exit', function(error) {
			if(error) {
				defer.reject({
					code: error,
					message: allData && allData.toString()
				});
			}
			else {
				// Converting to a string now is faster.
				defer.resolve(allData && allData.toString());
			}
		});

		buildProcess.on('error', function(error) {
			defer.reject(error);
		});

		return defer.promise;
	};

	this.nodeVersion = function() {
		return runTask('node', ['-v']);
	};

	this.build = function() {
		return runTask('grunt', ['build']);
	};

	this.release = function() {
		return runTask('grunt', ['release']);
	};

	this.run = function() {
		return runCommand('grunt', ['run']);
	};

	this.migrate = function(appName, version) {
		// TODO: Check if the app name is correct?!

		return runTask('grunt', ['release:migrate:' + version]);
	};
}
