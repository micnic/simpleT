var fs = require('fs');
var path = require('path');

// Parses the content and returns executable result
function parse(content, open, close) {
    'use strict';

    var buffer = '',
        closeLength = close.length,
        code = false,
        currentChar,
        currentSec,
        expression = false,
        index = 0,
        openLength = open.length,
        previousChar = '',
        result = '',
        stop = '',
        whitespace = '';

    // Parse char by char
    while (currentChar = content.charAt(index)) {

        // Found code delimiter
        if (content.substr(index, openLength) === open) {
            index += openLength;
            currentChar = content.charAt(index);
            code = true;

            // Found print statement
            if (currentChar === '=') {

                // Add whitespace for print statements
                if (whitespace) {
                    result += '_result+=\'' + whitespace + '\';';
                }

                result += 'print(';
                expression = true;
                code = false;
                index++;

            // Found include statement
            } else if (currentChar === '#') {
                result += 'include(';
                expression = true;
                index++;
            }

            // Get the chars of the code
            while ((currentChar = content.charAt(index)) && content.substr(index, closeLength) !== close) {

                // Take the close tags in javascript string
                if ((currentChar === '\'' || currentChar === '"') && previousChar !== '\\') {
                    stop = currentChar;
                    result += currentChar;
                    index++;
                    while ((currentChar = content.charAt(index)) && currentChar !== stop && previousChar !== '\\') {
                        result += currentChar;
                        previousChar = currentChar;
                        index++;
                    }
                }

                result += currentChar;
                previousChar = currentChar;
                index++;
            }

            // Check for unexpected end of line
            if (!currentChar) {
                throw 'Unexpected end of template';
            }

            // Close open expression if found
            if (expression) {
                result += ')';
                expression = false;
            }

            result += '\n';
            index += closeLength;
            whitespace = '';

        // Found other chars
        } else if (currentChar) {

            // While no code found
            while ((currentChar = content.charAt(index)) && (currentSec = content.substr(index, openLength)) !== open) {

                // Ignore whitespace on the lines with code
                if (currentChar === ' ' || currentChar === '\t') {
                    whitespace += currentChar;

                // Escape for end of line
                } else if (currentChar === '\n' || currentSec === '\r\n' || currentChar === '\r' || currentChar === '\u2028' || currentChar === '\u2029') {

                    // Add whitespace if not after code
                    if (code) {
                        whitespace = '';
                    } else {
                        buffer += whitespace + '\\n';
                    }

                    // If Windows end of line
                    if (currentSec === '\r\n') {
                        index++;
                    }

                // Get all other chars
                } else {

                    buffer += whitespace;
                    whitespace = '';
                    code = false;

                    // Escape for "'" and "\"
                    if (currentChar === '\'' || currentChar === '\\') {
                        buffer += '\\';
                    }

                    buffer += currentChar;
                }

                index++;
            }

            // Concatenate the buffer if it exists
            if (buffer) {
                result += '_result+=\'' + buffer + '\';';
                buffer = '';
            }
        }
    }

    return result;
}

var simplet = module.exports = function (config) {
    'use strict';

    // Ignore new keyword
    if (!(this instanceof simplet)) {
        return new simplet(config);
    }

    // Set up the engine configuration
    config = config || {};

    Object.defineProperties(this, {
        cache: {
            value: {}
        },
        close: {
            value: config.close || '%>'
        },
        globals: {
            value: config.globals || {}
        },
        open: {
            value: config.open || '<%'
        },
        raw: {
            value: config.raw || false
        }
    });
};

// Removes sources from cache or clears the cache completely
simplet.prototype.clear = function (source) {
    'use strict';
    if (source) {
        delete this.cache[source];
    } else {
        this.cache = {};
    }
};

// Compiles the raw content and requrns the result
simplet.prototype.compile = function (content, imports) {
    'use strict';
    var i,
        parameters = [],
        values = [];

    // Add global values from the template engine
    for (i in this.globals) {
        parameters.push(i);
        values.push(this.globals[i]);
    }

    // Populate the parameters and the values for the executable frunction
    for (i in imports) {
        parameters.push(i);
        values.push(imports[i]);
    }

    return new Function(parameters.join(), content).apply(this, values);
};

// Cache the source for further usage
simplet.prototype.precache = function (source) {
    'use strict';
    var cache,
        content,
        id,
        that = this;

    // Get the identifier and the content of the template
    if (typeof source === 'string') {
        id = source;
        try {
            content = fs.readFileSync(source, 'utf8');
            fs.watch(source, {
                persistent: false
            }, function (event, filename) {
                if (event === 'rename') {
                    this.close();
                    delete that.cache[id];
                    return;
                }

                content = new Buffer(0);
                fs.ReadStream(source).on('readable', function () {
                    content = Buffer.concat([content, this.read()]);
                }).on('end', function () {
                    that.cache[id] = parse(content.toString(), that.open, that.close);
                });
            });
        } catch (error) {
            console.log('\nsimpleT: can not read source "' + source + '"\n' + error.message + '\n');
            return;
        }
    } else {
        id = source.id;
        content = source.content;
    }

    // Try to parse content
    try {
        cache = parse(content, this.open, this.close);

        // Cache only if identifier is provided
        if (id) {
            this.cache[id] = cache;
        }

        return cache;
    } catch (error) {
        console.log('\nsimpleT: Unexpected end of template in source "' + id + '"\n');
        return;
    }
};

// Render templates from strings or files
simplet.prototype.render = function (source, imports) {
    'use strict';

    var id = typeof source === 'string' ? source : source.id,
        executable,
        result = this.cache[id] || this.precache(source);

    // Prepare the executable string
    executable = 'var _result=\'\',include=function(file,imports){_result+=this.render(\'' + (id ? path.dirname(id) : path.dirname(module.parent.filename)) + '\'+\'/\'+file,imports)}.bind(this),print=function(){var result=\'\';for(var i=0,n=arguments.length;i<n;i++)if(typeof arguments[i]===\'string\'||(arguments[i] instanceof String))result+=arguments[i];else result+=JSON.stringify(arguments[i]);for(var i=0,n=result.length;i<n;i++)if(result.charAt(i)===\'&\'||result.charAt(i)===\'<\'||result.charAt(i)===\'>\')result=result.substring(0,i)+\'&#\'+result.charCodeAt(i)+\';\'+result.substring(i+1),i+=4,n+=4;_result+=result};' + result + ';\nreturn _result';

    // Return raw content if the engine is configured
    return this.raw ? executable : this.compile(executable, imports);
};

// Public the content for client side template engine
module.exports.client = fs.readFileSync(__dirname + '/utils/simplet.js');