#! /usr/bin/env node
//https://developer.chrome.com/extensions/crx

var
fs = require('fs'),
path = require('path'),
util = require('util'),
crypto = require('crypto'),
async = require('async'),
UglifyJS = require('uglify-js'),
JSZip = require("jszip");

var
/* 
 *  递归列出目录下的文件 
 *  callback(err,filelist);
*/
ls = function(dir,callback){
	async.waterfall([
		/* 列出文件 */
		function(callback){
			fs.readdir(dir, callback);
		},
		/* 调整文件名 */
		function(files, callback){
			async.map(files, function(file, callback){
				callback(null, path.join(dir,file));
			}, callback);
		},
		/* 查询状态 */
		function(files, callback){
			async.map(files, function(file, callback){
				fs.stat(file,function(err, stat){
					if(err){
						callback(err);
					}
					else{
						callback(null,{file:file,isDir:stat.isDirectory()});
					}
				});
			},callback);
		},
		/* 合并数组 */
		function(files,callback){
			async.concat(files, function(obj,callback){
				if(obj.isDir){
					ls(obj.file, callback);
				}
				else{
					callback(null, [obj.file]);
				}
			},callback);
		}
	],callback);
},
/* 删除单个文件 */
rmFile = function(file, callback){
	async.waterfall([
		/* 判断文件是否存在 */
		function(callback){
			fs.exists(file, function (exists){
				callback(exists?null:1);
			});
		},
		function(callback){
			fs.stat(file,function(err, stat){
				if(err){
					callback(err);
					return;
				}
				if(stat.isDirectory()){
					callback(true);
				}
				else{
					callback(null);
				}
			})
		},
		function(callback){
			fs.unlink(file, callback)
		}
	],function(err){
		if((!err)||(err===1)){
			callback(null)
		}
		else{
			callback(util.format('remove %s failed'), file);
		}
	});
}
/* 
 *  删除目录
 *  callback(err);
*/
rmDir = function(target, callback){
	async.waterfall([
		/* 判断文件是否存在 */
		function(callback){
			fs.exists(target, function (exists){
				callback(exists?null:1);
			});
		},
		/* 列出要删除的文件 */
		function(callback){
			fs.readdir(target, callback);
		},
		/* 调整文件名 */
		function(files, callback){
			async.map(files, function(file, callback){
				callback(null, path.join(target,file));
			}, callback);
		},
		/* 查询状态 */
		function(files, callback){
			async.map(files, function(file, callback){
				fs.stat(file,function(err, stat){
					if(err){
						callback(err);
					}
					else{
						callback(null,{file:file,isDir:stat.isDirectory()});
					}
				});
			},callback);
		},
		/* 删除文件 */
		function(list, callback){
			async.each(list, function(obj, callback){
				if(obj.isDir){
					rmDir(obj.file, callback);
				}
				else{
					fs.unlink(obj.file,function(err){
						callback(err);
					});
				}				
			},callback);
		},
		/* 删除当前目录 */
		function(callback){
			fs.rmdir(target, callback);
		}
	], function(err) {
		if((!err)||(err===1)){
			callback(null)
		}
		else{
			callback(util.format('remove %s failed'), target);
		}
	});
},
/*复制文件*/
cpFile =  function(src, dest, callback){
	var 
	read = fs.createReadStream(src),
	write = fs.createWriteStream(dest);
	read.on('end', function () {
		write.end();
		callback(null);
	});
	read.on('error', function (err) {
		callback(true);
	});
	read.pipe(write);
},
/*复制目录*/
cpDir = function(src, dest, callback){
	async.waterfall([
		function(callback){
			/* 并发的检测 */
			async.parallel([
				/* 判断源文件是否存在 */
				function(callback){
					fs.exists(src, function (exists){
						callback(exists?null:true);
					});
				},
				/* 判断目标文件是否不存在 */
				function(callback){
					fs.exists(dest, function (exists){
						callback(exists?true:null);
					});
				}
			],function(err){
				callback(err);
			});			
		},
		/* 创建目标文件夹 */
		function(callback){
			fs.mkdir(dest, callback);
		},
		/* 列出要复制的文件 */
		function(callback){
			fs.readdir(src, callback);
		},
		/* 调整文件名 */
		function(files, callback){
			async.map(files, function(file, callback){
				callback(null, {src:path.join(src,file),dest:path.join(dest,file)});
			}, callback);
		},
		/* 查询状态 */
		function(data, callback){
			async.map(data, function(obj, callback){
				fs.stat(obj.src,function(err, stat){
					if(err){
						callback(err);
					}
					else{
						obj.isDir = stat.isDirectory();
						callback(null,obj);
					}
				});
			},callback);
		},
		/* 复制文件 */
		function(list, callback){
			async.each(list, function(obj, callback){
				if(obj.isDir){
					cpDir(obj.src, obj.dest, callback);
				}
				else{
					cpFile(obj.src, obj.dest, callback);
				}				
			},callback);
		}
	],function(err){
		if(err){
			callback(util.format('copy %s failed'), src);
		}
		else{
			callback(null);
		}
	});
},
/* 压缩单个JS */
uglify = function(file, callback){
	async.waterfall([
		function(callback){
			fs.exists(file, function (exists){
				callback(exists?null:util.format('%s not found', file));
			});
		},
		function(callback){
			fs.readFile(file, callback);
		},
		function(data, callback){
			var code = data.toString('utf8')
			try{
				result = UglifyJS.minify(code, {fromString:true});
			}
			catch(e){
				callback(util.format('uglify %s faild', file));
			}
			callback(null,result.code);
		},
		function(data, callback){
			fs.writeFile(file, data, callback);
		},
	],function(err){
		callback(err);
	});
},
/* 压缩目录中的全部JS */
uglifyALL = function(dir, callback){
	async.waterfall([
		function(callback){
			ls(dir, callback);
		},
		function(list, callback){
			async.filter(list, function(file, callback){
				var ext = path.extname(file).toLowerCase();
				callback(ext==='.js');
			}, function(results){
				callback(null,results);
			});
		},
		function(list, callback){
			async.each(list, function(file, callback){
				uglify(file,callback);
			}, function(err){
				callback(err);
			});
		}
	],callback);
},
zip = function(dir,zipFile,callback){
	async.waterfall([
		/* 判断文件是否存在 */
		function(callback){
			fs.exists(dir, function (exists){
				callback(exists?null:1);
			});
		},
		function(callback){
			fs.readdir(dir, callback);
		},
		/* 查询状态 */
		function(files, callback){
			async.map(files, function(file, callback){
				fs.stat(path.join(dir,file),function(err, stat){
					if(err){
						callback(util.format('check %s failed',file));
					}
					else{
						callback(null,{file:file,isDir:stat.isDirectory()});
					}
				});
			},callback);
		},
		function(list, callback){
			async.each(list, function(obj, callback){
				if(obj.isDir){
					zip(path.join(dir,obj.file),zipFile.folder(obj.file), callback);
				}
				else{
					fs.readFile(path.join(dir,obj.file), function (err, data) {
					  if(err){
					  	callback(util.format('read %s failed', obj.file));
					  }
					  else{
					  	zipFile.file(obj.file,data);
					  	callback(null);
					  }
					});
				}				
			},callback);
		}
	], function(err) {
		if((!err)||(err===1)){
			callback(null)
		}
		else{
			callback(err);
		}
	});
},
zipDir = function(dir,target,callback){
	var zipFile = new JSZip();
	zip(dir,zipFile,function(err){
		if(!err){
			var content = zipFile.generate({type:"nodebuffer"});
			fs.writeFile(target, content, callback);
		}
		else{
			callback(err);
		}
		
	});
},
pack = function(zipfile, crxfile, public_key, private_key ,callback){
	var crx_header = {
		crmagic_hex:new Buffer([0x43,0x72,0x32,0x34]),
		version_hex:new Buffer([0x02,0x00,0x00,0x00]),
		pub_len_hex:new Buffer([0x00,0x00,0x00,0x00]),
		sig_len_hex:new Buffer([0x00,0x00,0x00,0x00]),
		pub:null,
		sig:null
	};
	async.series([
		/* 生成文件头 */
		function(callback){
			async.parallel([
				/* 读取公钥 */
				function(callback){
					fs.readFile(public_key, {encoding :'ascii'}, function (err, data) {
						if(err){
							callback(true);
						}
						else{
							data = data.replace(/-.*-/g,'').trim();
							var publicKey = new Buffer(data, 'base64');
							crx_header.pub = publicKey;
							crx_header.pub_len_hex.writeUInt16LE(crx_header.pub.length,0);
							callback(false);
						}
					});
				},
				/* 读取私钥并签名 */
				function(callback){
					fs.readFile(private_key, {encoding :'ascii'}, function (err, privateKey) {
						if(err){
							callback(true);
						}
						else{
							var 
							sign = crypto.createSign('sha1'),
							stream = fs.ReadStream(zipfile);
							
							stream.on('end', function() {
								crx_header.sig = sign.sign(privateKey);
								crx_header.sig_len_hex.writeUInt16LE(crx_header.sig.length,0);
								callback(false);
							});							
							stream.pipe(sign);
						}
					});
				}
			],callback);
		},
		/* 写文件 */
		function(callback){
			var crx_stream = fs.createWriteStream(crxfile);
			async.series([
				function(callback){
					crx_stream.write(crx_header.crmagic_hex,callback);
				},
				function(callback){
					crx_stream.write(crx_header.version_hex,callback);
				},
				function(callback){
					crx_stream.write(crx_header.pub_len_hex,callback);
				},
				function(callback){
					crx_stream.write(crx_header.sig_len_hex,callback);
				},
				function(callback){
					crx_stream.write(crx_header.pub,callback);
				},
				function(callback){
					crx_stream.write(crx_header.sig,callback);
				},
				function(callback){
					var zip_stream = fs.createReadStream(zipfile);
					zip_stream.on('end',function(){callback(false)});
					zip_stream.pipe(crx_stream);
				}
			],callback);
		}
	],callback);
};

/* 主流程 */
async.series([
	/* 删除残余文件 */
	function(callback){
		rmDir('_temp', callback);
	},
	/* 复制源代码目录到发布目录 */
	function(callback){
		cpDir('src', '_temp', callback);
	},
	/* 压缩JS */
	function(callback){
		uglifyALL('_temp', callback);
	},
	/* 删除旧的打包zip */
	function(callback){
		rmFile('plugin.zip', callback);
	},
	function(callback){
		zipDir('_temp','plugin.zip', callback);
	},
	/* 删除残余文件 */
	function(callback){
		rmDir('_temp', callback);
	},
	/* 删除旧的打包crx */
	function(callback){
		rmFile('plugin.crx', callback);
	},
	function(callback){
		pack('plugin.zip','plugin.crx','key/public.pem','key/private.pem',callback);
	},
	/* 删除临时zip */
	function(callback){
		rmFile('plugin.zip', callback);
	}
],function(err){
	if(err){
		if(util.isError(err)){
			console.log(err.message);
		}
		else{
			console.log(err);
		}
	}
	else{
		console.log('OK');
	}
});
