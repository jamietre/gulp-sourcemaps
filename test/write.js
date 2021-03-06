'use strict';

var test = require('tape');
var sourcemaps = require('..');
var File = require('vinyl');
var ReadableStream = require('stream').Readable;
var path = require('path');
var fs = require('fs');
var recordConsole = require('./consolerecorder.js');

var sourceContent = fs.readFileSync(path.join(__dirname, 'assets/helloworld.js')).toString();

function makeSourceMap(fileName) {
    fileName = fileName || "helloworld.js";
    
    return {
        version: 3,
        file: fileName,
        names: [],
        mappings: '',
        sources: [ fileName ],
        sourcesContent: [ sourceContent ]
    };
}

function base64JSON(object) {
    return 'data:application/json;base64,' + new Buffer(JSON.stringify(object)).toString('base64');
}

function makeFile(opts) {
    opts = opts || {};
    opts.file = opts.file || 'helloworld.js';
    opts.cwd = opts.cwd || __dirname;
    opts.path = opts.path || path.join(opts.cwd, 'assets', opts.file);
    opts.base = opts.base || path.join(opts.cwd, 'assets');

    var file = new File({
        cwd: opts.cwd,
        base: opts.base,
        path: opts.path,
        contents: new Buffer(sourceContent)
    });
    file.sourceMap = makeSourceMap(opts.file);
    return file;
}

function makeNestedFile(){
	var file = new File({
        cwd: __dirname,
        base: path.join(__dirname, 'assets'),
        path: path.join(__dirname, 'assets', 'dir1', 'dir2', 'helloworld.js'),
        contents: new Buffer(sourceContent)
    });
    file.sourceMap = makeSourceMap();
    return file;
}

function makeStreamFile() {
    var file = new File({
        cwd: __dirname,
        base: path.join(__dirname, 'assets'),
        path: path.join(__dirname, 'assets', 'helloworld.js'),
        contents: new ReadableStream()
    });
    file.sourceMap = {};
    return file;
}


test('write: should pass through when file is null', function(t) {
    var file = new File();
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.ok(data, 'should pass something through');
            t.ok(data instanceof File, 'should pass a vinyl file through');
            t.deepEqual(data, file, 'should not change file');
            t.equal(data.contents, null, 'should not change file content');
            t.end();
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should pass through when file has no source map', function(t) {
    var file = makeFile();
    delete file.sourceMap;
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.ok(data, 'should pass something through');
            t.ok(data instanceof File, 'should pass a vinyl file through');
            t.deepEqual(data, file, 'should not change file');
            t.equal(String(data.contents), sourceContent, 'should not change file content');
            t.end();
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should emit an error if file content is a stream', function(t) {
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.fail('should emit an error');
            t.end();
        })
        .on('error', function() {
            t.ok('should emit an error');
            t.end();
        })
        .write(makeStreamFile());
});

test('write: should write an inline source map', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.ok(data, 'should pass something through');
            t.ok(data instanceof File, 'should pass a vinyl file through');
            t.deepEqual(data, file, 'should not change file');
            t.equal(String(data.contents),
                sourceContent + '\n//# sourceMappingURL=' + base64JSON(data.sourceMap) + '\n',
                'should add source map as comment');
            t.end();
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should use CSS comments if CSS file', function(t) {
    var file = makeFile();
    file.path = file.path.replace('.js', '.css');
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.equal(String(data.contents),
                sourceContent + '\n/*# sourceMappingURL=' + base64JSON(data.sourceMap) + ' */\n',
                'should add source map with CSS comment');
            t.end();
        })
        .write(file);
});

test('write: should write no comment if not JS or CSS file', function(t) {
    var file = makeFile();
    file.path = file.path.replace('.js', '.txt');
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.equal(String(data.contents), sourceContent);
            t.end();
        })
        .write(file);
});

test('write: should write external map files', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write('../maps');
    var fileCount = 0;
    var outFiles = [];
    var sourceMap;
    pipeline
        .on('data', function(data) {
            outFiles.push(data);
            fileCount++;
            if (fileCount == 2) {
                outFiles.reverse().map(function(data) {
                    if (data.path === path.join(__dirname, 'assets/helloworld.js')) {
                        sourceMap = data.sourceMap;
                        t.ok(data instanceof File, 'should pass a vinyl file through');
                        t.deepEqual(data, file, 'should not change file');
                        t.equal(String(data.contents),
                            sourceContent + '\n//# sourceMappingURL=../maps/helloworld.js.map\n',
                            'should add a comment referencing the source map file');
                    } else {
                        t.ok(data instanceof File, 'should pass a vinyl file through');
                        t.equal(data.path, path.join(__dirname, 'maps/helloworld.js.map'));
                        t.deepEqual(JSON.parse(data.contents), sourceMap, 
                            'should have the file\'s source map as content');
                    }
                });
                t.end();
            }
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should create shortest path to map in file comment', function(t) {
    var file = makeNestedFile();
    var pipeline = sourcemaps.write('dir1/maps');
    var fileCount = 0;
    var outFiles = [];
    var sourceMap;
    pipeline
        .on('data', function(data) {
            outFiles.push(data);
            fileCount++;
            if (fileCount == 2) {
                outFiles.reverse().map(function(data) {
                    if (data.path === path.join(__dirname, 'assets/dir1/dir2/helloworld.js')) {
                        t.equal(String(data.contents),
                            sourceContent + '\n//# sourceMappingURL=../maps/dir1/dir2/helloworld.js.map\n',
                            'should add a comment referencing the source map file');
                    }
                });
                t.end();
            }
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should write no comment with option addComment=false', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({addComment: false});
    pipeline
        .on('data', function(data) {
            t.equal(String(data.contents), sourceContent, 'should not change file content');
            t.end();
        })
        .write(file);
});

test('write: should not include source content with option includeContent=false', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({includeContent: false});
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourcesContent, undefined, 'should not have source content');
            t.end();
        })
        .write(file);
});

test('write: should fetch missing sourceContent', function(t) {
    var file = makeFile();
    delete file.sourceMap.sourcesContent;
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.notEqual(data.sourceMap.sourcesContent, undefined, 'should have source content');
            t.deepEqual(data.sourceMap.sourcesContent, [sourceContent], 'should have correct source content');
            t.end();
        })
        .write(file);
});

test('write: should not throw when unable to fetch missing sourceContent', function(t) {
    var file = makeFile();
    file.sourceMap.sources[0] += '.invalid';
    delete file.sourceMap.sourcesContent;
    var pipeline = sourcemaps.write();
    pipeline
        .on('data', function(data) {
            t.notEqual(data.sourceMap.sourcesContent, undefined, 'should have source content');
            t.deepEqual(data.sourceMap.sourcesContent, [], 'should have correct source content');
            t.end();
        })
        .write(file);
});

test('write: should set the sourceRoot by option sourceRoot', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({sourceRoot: '/testSourceRoot'});
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourceRoot, '/testSourceRoot', 'should set sourceRoot');
            t.end();
        })
        .write(file);
});

test('write: should set the sourceRoot by option sourceRoot, as a function', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({
      sourceRoot: function(file) { return '/testSourceRoot'; }
    });
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourceRoot, '/testSourceRoot', 'should set sourceRoot');
            t.end();
        })
        .write(file);
});

test('write: should accept a sourceMappingURLPrefix', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write('../maps', { sourceMappingURLPrefix: 'https://asset-host.example.com' });
    pipeline
      .on('data', function(data) {
        if (/helloworld\.js$/.test(data.path)) {
          t.equal(String(data.contents).match(/sourceMappingURL.*\n$/)[0],
            'sourceMappingURL=https://asset-host.example.com/maps/helloworld.js.map\n');
          t.end();
        }
      })
      .write(file);
});

test('write: should accept a sourceMappingURLPrefix, as a function', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write('../maps', {
        sourceMappingURLPrefix: function(file) { return 'https://asset-host.example.com'; }
    });
    pipeline
      .on('data', function(data) {
        if (/helloworld\.js$/.test(data.path)) {
          t.equal(String(data.contents).match(/sourceMappingURL.*\n$/)[0],
            'sourceMappingURL=https://asset-host.example.com/maps/helloworld.js.map\n');
          t.end();
        }
      })
      .write(file);
});

test('write: should invoke sourceMappingURLPrefix every time', function(t) {
    var times = 0;
    var pipeline = sourcemaps.write('../maps', {
        sourceMappingURLPrefix: function(file) { ++times; return 'https://asset-host.example.com/' + times; }
    });

    pipeline
      .on('data', function(data) {
        if (/helloworld\.js$/.test(data.path)) {
          t.equal(String(data.contents).match(/sourceMappingURL.*\n$/)[0],
                  'sourceMappingURL=https://asset-host.example.com/'+ times + '/maps/helloworld.js.map\n');
          if (times >= 3) {
            t.end();
            return;
          }
          pipeline.write(makeFile());
        }
      })
      .write(makeFile());
});

test('write: should output an error message if debug option is set and sourceContent is missing', function(t) {
    var file = makeFile();
    file.sourceMap.sources[0] += '.invalid';
    delete file.sourceMap.sourcesContent;

    var hConsole = recordConsole();
    var pipeline = sourcemaps.write({debug: true});
    pipeline
        .on('data', function(data) {
            hConsole.restore();
            t.equal(hConsole.history.log[0], 'gulp-sourcemap-write: No source content for "helloworld.js.invalid". Loading from file.', 'should log missing source content');
            t.ok(hConsole.history.warn[0].indexOf('gulp-sourcemap-write: source file not found: ') === 0, 'should warn about missing file');
            t.end();
        })
        .write(file);
});

test('write: null as sourceRoot should not set the sourceRoot', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({sourceRoot: null});
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourceRoot, undefined, 'should not set sourceRoot');
            t.end();
        })
        .write(file);
});

test('write: function returning null as sourceRoot should not set the sourceRoot', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({
      sourceRoot: function(file) { return null; }
    });
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourceRoot, undefined, 'should set sourceRoot');
            t.end();
        })
        .write(file);
});

test('write: empty string as sourceRoot should be kept', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({sourceRoot: ''});
    pipeline
        .on('data', function(data) {
            t.equal(data.sourceMap.sourceRoot, '', 'should keep empty string as sourceRoot');
            t.end();
        })
        .write(file);
});

test('write: should be able to fully control sourceMappingURL by the option sourceMappingURL', function(t) {
    var file = makeNestedFile();
    var pipeline = sourcemaps.write('../aaa/bbb/', {
      sourceMappingURL: function(file) {
        return 'http://maps.example.com/' + file.relative.split(path.sep).join('/') + '.map';
      }
    });
    pipeline
        .on('data', function(data) {
            if (/helloworld\.js$/.test(data.path)) {
                t.equal(String(data.contents),
                    sourceContent + '\n//# sourceMappingURL=http://maps.example.com/dir1/dir2/helloworld.js.map\n',
                    'should add source map comment with custom url');
                t.end();
            }
        })
        .write(file);
});

test('write: should allow to change sources', function(t) {
    var file = makeFile();
    var pipeline = sourcemaps.write({mapSources: function(sourcePath) {
        return '../src/' + sourcePath;
    }});
    pipeline
        .on('data', function(data) {
            t.deepEqual(data.sourceMap.sources, ['../src/helloworld.js'], 'should have the correct sources');
            t.end();
        })
        .on('error', function() {
            t.fail('emitted error');
            t.end();
        })
        .write(file);
});

test('write: should calculate relative path to source when #outputRoot is present', function(t) {

    var cases = [
    {
        desc: "parallel",
        cwd: '/',
        outputPath: 'dest',
        base: '/src/',
        path: '/src/index.js',
        expected: '../src/index.js'
    },
    {
        desc: "parallel - nested targets from cwd",
        cwd: '/usr/home',
        outputPath: 'test/dist',
        base: '/usr/home/test/src/',
        path: '/usr/home/test/src/index.js',
        expected: '../src/index.js'
    },
    {
        desc: "parallel deep",
        cwd: '/root',
        outputPath: 'dest',
        base: '/root/src/',
        path: '/root/src/a/b/c/index.js',
        expected: '../../../../src/a/b/c/index.js'
    },
    {
        desc: "subfolder",
        cwd: '/test',
        outputPath: 'dest/sub',
        base: '/test/src',
        path: '/test/src/index.js',
        expected: '../../src/index.js'
    },
    {
        desc: "subfolder deep",
        cwd: '/',
        outputPath: 'dest/compiled',
        base: '/src/',
        path: '/src/a/b/c/index.js',
        expected: '../../../../../src/a/b/c/index.js'
    },
    {
        desc: "same folder - no output path specified",
        cwd: '/',
        outputPath: '',
        base: '/src/',
        path: '/src/a/index.js',
        expected: 'index.js'
    },
   
    
    ]

    function nextCase(caseNum) {
        var current = cases[caseNum];

        console.log('starting case "' + current.desc + '": path = ' + current.path)
        var file = makeFile({
            cwd: current.cwd,
            file: "index.js",
            path: current.path,
            base: current.base
        });

        var pipeline = sourcemaps.write(".", {
            destPath: current.outputPath
        });    

        pipeline
            .on('data', function(data) {
                if (/index\.js\.map$/.test(data.path)) {
                    t.deepEqual(JSON.parse(data.contents.toString('utf-8')).sources, 
                        [current.expected], 'sources relative path case: "' + current.desc + '"');

                    if (caseNum === cases.length-1) {
                        t.end();
                    } else {
                        nextCase(caseNum+1);
                    }
                }
            })
            .write(file);
    }

    
    nextCase(0);


});
