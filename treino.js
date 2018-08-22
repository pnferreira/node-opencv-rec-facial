module.exports = function (RED) {
	var spawn = require('child_process').spawn;
	var util = require('util');

	function indentLines(fnCode, depth) {
			return fnCode.split('\n').map((line) => Array(depth).join(' ') + line).join('\n')
	}

	function spawnFn(self) {
			self.child = spawn('python', ['-uc', self.func.code], {
					stdio: ['pipe', 'pipe', 'pipe', 'ipc']
			});
			self.child.stdout.on('data', function (data) {
					self.log(data.toString());
			});
			self.child.stderr.on('data', function (data) {
					self.error(data.toString());
			});
			self.child.on('close', function (exitCode) {
					if (exitCode) {
							self.error(`Python Function process exited with code ${exitCode}`);
							if (self.func.attempts) {
									spawnFn(self);
									self.func.attempts--;
							} else {
									self.error(`Function '${self.name}' has failed more than 10 times. Fix it and deploy again`)
									self.status({
											fill: 'red',
											shape: 'dot',
											text: 'Stopped, see debug panel'
									});
							}
					}
			});
			self.child.on('message', function (response) {
					switch (response.ctx) {
							case 'send':
									sendResults(self, response.msgid, response.value);
									break;
							case 'log':
							case 'warn':
							case 'error':
							case 'status':
									self[response.ctx].apply(self, response.value);
									break;
							default:
									throw new Error(`Don't know what to do with ${response.ctx}`);
					}
			});
			self.log(`Python function '${self.name}' running on PID ${self.child.pid}`);
			self.status({
					fill: 'green',
					shape: 'dot',
					text: 'Func Ok!'
			});
	}

	function sendResults(self, _msgid, msgs) {
			if (msgs == null) {
					return;
			} else if (!util.isArray(msgs)) {
					msgs = [msgs];
			}
			var msgCount = 0;
			for (var m = 0; m < msgs.length; m++) {
					if (msgs[m]) {
							if (util.isArray(msgs[m])) {
									for (var n = 0; n < msgs[m].length; n++) {
											msgs[m][n]._msgid = _msgid;
											msgCount++;
									}
							} else {
									msgs[m]._msgid = _msgid;
									msgCount++;
							}
					}
			}
			if (msgCount > 0) {
					self.send(msgs);
			}
	}

	function PythonFunction(config) {
			var self = this;
			RED.nodes.createNode(self, config);
			self.name = config.name;
			self.func = {
					code: `
import os
import json
import sys

channel = None
if sys.version_info[0]<3:
	channel = os.fdopen(3, "r+")
else:
	channel = os.fdopen(3, "r+b", buffering=0)

class Msg(object):
	SEND = 'send'
	LOG = 'log'
	WARN = 'warn'
	ERROR = 'error'
	STATUS = 'status'

	def __init__(self, ctx, value, msgid):
			self.ctx = ctx
			self.value = value
			self.msgid = msgid

	def dumps(self):
			return json.dumps(vars(self)) + "\\n"

	@classmethod
	def loads(cls, json_string):
			return cls(**json.loads(json_string))


class Node(object):
	def __init__(self, msgid, channel):
			self.__msgid = msgid
			self.__channel = channel

	def send(self, msg):
			msg = Msg(Msg.SEND, msg, self.__msgid)
			self.send_to_node(msg)

	def log(self, *args):
			msg = Msg(Msg.LOG, args, self.__msgid)
			self.send_to_node(msg)

	def warn(self, *args):
			msg = Msg(Msg.WARN, args, self.__msgid)
			self.send_to_node(msg)

	def error(self, *args):
			msg = Msg(Msg.ERROR, args, self.__msgid)
			self.send_to_node(msg)

	def status(self, *args):
			msg = Msg(Msg.STATUS, args, self.__msgid)
			self.send_to_node(msg)

	def send_to_node(self, msg):
			m = msg.dumps()
			if sys.version_info[0]>2:
					m = m.encode("utf-8")
			self.__channel.write(m)



` + 
//indentLines(config.func, 4) 
`
import cv2,os
import numpy as np
from PIL import Image

recognizer = cv2.face.LBPHFaceRecognizer_create()
detector= cv2.CascadeClassifier("/Users/poliana-ferreira/.node-red/haarcascade_frontalface_default.xml")

def getImagesAndLabels(path):
    #get the path of all the files in the folder
    imagePaths=[os.path.join(path,f) for f in os.listdir(path)] 
    #create empth face list
    faceSamples=[]
    #create empty ID list
    Ids=[]
    #now looping through all the image paths and loading the Ids and the images
    for imagePath in imagePaths:

        # Updates in Code
        # ignore if the file does not have jpg extension :
        if(os.path.split(imagePath)[-1].split(".")[-1]!='jpg'):
            continue

        #loading the image and converting it to gray scale
        pilImage=Image.open(imagePath).convert('L')
        #Now we are converting the PIL image into numpy array
        imageNp=np.array(pilImage,'uint8')
        #getting the Id from the image
        Id=int(os.path.split(imagePath)[-1].split(".")[1])
        # extract the face from the training image sample
        faces=detector.detectMultiScale(imageNp)
        #If a face is there then append that in the list as well as Id of it
        for (x,y,w,h) in faces:
            faceSamples.append(imageNp[y:y+h,x:x+w])
            Ids.append(Id)
    return faceSamples,Ids

def python_function(msg):
    faces,Ids = getImagesAndLabels('dataSet')
    recognizer.train(faces, np.array(Ids))
    recognizer.save('trainner.yml')
    return msg
`
+
							`
while True:
	raw_msg = channel.readline()
	if not raw_msg:
			raise RuntimeError('Received EOF!')
	msg = json.loads(raw_msg)
	msgid = msg["_msgid"]
	node = Node(msgid, channel)
	res_msgs = python_function(msg)
	node.send(res_msgs)
`,
					attempts: 10
			};
			spawnFn(self);
			self.on('input', function (msg) {
					var cache = [];
					jsonMsg = JSON.stringify(msg, function (key, value) {
							if (typeof value === 'object' && value !== null) {
									if (cache.indexOf(value) !== -1) {
											// Circular reference found, discard key
											return;
									}
									// Store value in our collection
									cache.push(value);
							}
							return value;
					});
					cache = null; // Enable garbage collection
					self.child.send(JSON.parse(jsonMsg));
			});
			self.on('close', function () {
					self.child.kill();
			});
	}
	RED.nodes.registerType('treino', PythonFunction);
};
