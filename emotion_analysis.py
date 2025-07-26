import sys
import json
from pyAudioAnalysis import audioSegmentation as aS

filename = sys.argv[1]

# Returns (flags, classes, centers)
[segments, classes, _] = aS.mtFileClassification(filename, "pyAudioAnalysis/data/svmSpeechEmotion", "svm", True)

emotions = []
frame_size = 2.0
for i, label in enumerate(segments):
    emotions.append({
        "start": i * frame_size,
        "end": (i + 1) * frame_size,
        "emotion": classes[int(label)]
    })

print(json.dumps(emotions))
