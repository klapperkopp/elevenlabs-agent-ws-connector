import dotenv from "dotenv"
dotenv.config()

import localtunnel from "localtunnel"
import express from "express"
import axios from "axios"
import webSocket from "ws"
import expressWs from "express-ws"
import moment from "moment"
import * as fsp from "node:fs/promises"
import { tokenGenerate } from "@vonage/jwt"
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import qs from "qs"

const { app } = expressWs(express())

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// CORS policy - update this section as needed
app.use(function (req: express.Request, res: express.Response, next: express.NextFunction) {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE")
  res.header("Access-Control-Allow-Headers", "Origin, Accept, Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, X-From, X-To, X-Conversation-Uuid, X-Endpoint-Type, X-Uuid, X-Region-Url, X-Vcc-Session")
  next()
})

const PORT = process.env.VCR_PORT || process.env.PORT || 6000
const RECORD_ALL_AUDIO = process.env.RECORD_ALL_AUDIO == "true" ? true : false // local recordings (optional)
const TIMER = 18 // in ms, actual timer duration is higher, Streaming timer for audio packets to Vonage

// elevenlabs Config
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID

const elevenlabsClient = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

// Audio streaming timer calculation
let prevTime = Date.now()
let counter = 0
let total = 0
let cycles = 2000

// vonage conversation tracker
interface DynamicObj {
  [key: string]: any; // Allows any string key
}
const conversations: DynamicObj = {};

console.log('\n>>> Wait around', Math.round(cycles * TIMER / 1000), 'seconds to see the actual streaming timer average ...\n')

const streamTimer = setInterval(() => {

  const timeNow = Date.now()
  const difference = timeNow - prevTime
  total = total + difference
  prevTime = timeNow

  counter++

  if (counter == cycles) {
    clearInterval(streamTimer)
    console.log('\n>>> Average streaming timer (should be close to 20 AND under 20.000):', total / counter)
  };

}, TIMER)

//--- Websocket server (for WebSockets from Vonage Voice API platform) ---
app.ws('/socket', async (ws, req) => {
  try {
    const { from, to, conversation_uuid, endpoint_type, uuid, region_url } = req.query

    const { signedUrl } = await elevenlabsClient.conversationalAi.conversations.getSignedUrl({
      agentId: ELEVENLABS_AGENT_ID as string,
      includeConversationId: true,
    });

    const { conversation_id } = qs.parse(signedUrl)
    console.log("Precreated conversation ID:", conversation_id)

    conversations[conversation_id as string] = JSON.stringify({ from, to, conversation_uuid, uuid, endpoint_type, region_url })

    console.log('>>> WebSocket from Vonage platform')
    console.log('>>> Vonage call uuid:', uuid)

    let wsVgOpen = true // WebSocket to Vonage ready for binary audio payload?

    //-- audio recording files -- 
    const audioTo11lFileName = './recordings/' + uuid + '_rec_to_11l_' + moment(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '.raw' // using local time
    const audioToVgFileName = './recordings/' + uuid + '_rec_to_vg_' + moment(Date.now()).format('YYYY_MM_DD_HH_mm_ss_SSS') + '.raw' // using local time

    if (RECORD_ALL_AUDIO) {
      try {
        await fsp.writeFile(audioTo11lFileName, '')
      } catch (e) {
        console.log("Error creating file 1:", audioTo11lFileName, e)
      }
      console.log('File created:', audioTo11lFileName)

      try {
        await fsp.writeFile(audioToVgFileName, '')
      } catch (e) {
        console.log("Error creating file 2:", audioToVgFileName, e)
      }
      console.log('File created:', audioToVgFileName)
    }

    //-- stream audio to VG --
    let payloadToVg = Buffer.alloc(0)
    let streamToVgIndex = 0
    let lastTime = Date.now()
    let nowTime

    const elevenLabsTimer = setInterval(() => {
      if (payloadToVg.length != 0) {
        const streamToVgPacket = Buffer.from(payloadToVg).subarray(streamToVgIndex, streamToVgIndex + 640)  // 640-byte packet for linear16 / 16 kHz
        streamToVgIndex = streamToVgIndex + 640

        if (streamToVgPacket.length != 0) {
          if (wsVgOpen && streamToVgPacket.length == 640) {
            nowTime = Date.now()
            process.stdout.write(".")
            ws.send(streamToVgPacket)
            lastTime = nowTime

            if (RECORD_ALL_AUDIO) {
              try {
                fsp.appendFile(audioToVgFileName, streamToVgPacket, 'binary')
              } catch (error) {
                console.log("error writing to file 2:", audioToVgFileName, error)
              }
            }
          };
        } else {
          streamToVgIndex = streamToVgIndex - 640 // prevent index from increasing for ever as it is beyond buffer current length
        }
      }
    }, TIMER)

    //-- ElevenLabs connection ---
    let ws11LabsOpen = false // WebSocket to ElevenLabs ready for binary audio payload?
    const elevenLabsWs = new webSocket(signedUrl, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY }
    })

    elevenLabsWs.on('error', async (error: Error) => {
      console.log('>>> ElevenLabs WebSocket error:', error)
    })

    elevenLabsWs.on('open', async () => {
      console.log('>>> WebSocket to ElevenLabs opened')
      console.log(conversation_id)

      const initMessage = {
        "type": "conversation_initiation_client_data",
        "conversation_config_override": {
          "agent": {
            "prompt": {
              "prompt": "Du bist ein hilfsbereiter Kundensupport-Agent namens Hans Wurst."
            },
            //"first_message": "Hallo ich bin Hans Wurst.",
            "language": "de"
          },
          "tts": {
            "voice_id": ELEVENLABS_VOICE_ID
          }
        },
        "dynamic_variables": {
          "vonage_conversation_id": conversation_id as string
        }
        // https://elevenlabs.io/docs/eleven-agents/customization/personalization#conversation-initiation-client-data-structure
      }
      elevenLabsWs.send(JSON.stringify(initMessage))

      /*
      await elevenlabsClient.conversationalAi.agents.update(ELEVENLABS_AGENT_ID as string, {
        conversationConfig: {
          agent: {
            dynamicVariables: {
              vonage_conversation_id: conversation_id
            }
          }
        }
      });
      */
      ws11LabsOpen = true
    })

    elevenLabsWs.on('message', async (msg) => {
      const data = JSON.parse(msg.toString())
      switch (data.type) {
        case 'audio':
          const newAudioPayloadToVg = Buffer.from(data.audio_event.audio_base_64, 'base64')
          console.log('\n>>>', Date.now(), 'Received audio payload from ElevenLabs:', newAudioPayloadToVg.length, 'bytes')
          if (wsVgOpen) {
            payloadToVg = Buffer.concat([payloadToVg, newAudioPayloadToVg])
          }
          break

        case 'conversation_initiation_metadata':
          console.log('Elevenlabs conversation initiation metadata received:\n', data)
          console.log('Conversations initialized:', conversations)
          break
        case 'user_transcript':
          /*
          await axios.post(webhookUrl,
            {
              "type": 'user_transcript',
              "transcript": data.user_transcription_event.user_transcript,
              "call_uuid": uuid
            },
            {
              headers: {
                "Content-Type": 'application/json'
              }
            })
              */
          console.log('Elevenlabs Transcript received:\n', data)
          break

        case 'agent_response':
          console.log("Elevenlabs Agent response received:\n", data)
          /*
          await axios.post(WEBHOOK_URL,
            {
              "type": 'agent_response',
              "response": data.agent_response_event.agent_response,
              "call_uuid": uuid
            },
            {
              headers: {
                "Content-Type": 'application/json'
              }
            })
              */
          break

        case 'interruption':
          console.log('Elevenlabs Barge-in received:\n', data)
          payloadToVg = Buffer.alloc(0)  // reset stream buffer to VG
          streamToVgIndex = 0
          break

        case 'ping':
          console.log('Elevenlabs Ping received:\n', data)
          if (ws11LabsOpen) {
            elevenLabsWs.send(JSON.stringify({
              type: "pong",
              event_id: data.ping_event.event_id
            }))
          }
          break

        default:
          console.log('ElevenLabs message received:\n', data)
      }
    })

    elevenLabsWs.on('close', async (msg: any) => {
      ws11LabsOpen = false // stop sending audio payload to 11L platform
      console.log('\n>>> ElevenLabs WebSocket closed')
    })

    ws.on('message', async (msg: any) => {
      if (typeof msg === "string") {
        console.log(">>> Vonage Websocket message:", msg)
      } else if (msg.type === 'conversation_initiation_client_data') {
        console.log(">>> Forward EL message:", msg)
      } else {
        if (ws11LabsOpen) {
          elevenLabsWs.send(JSON.stringify({
            user_audio_chunk: msg.toString('base64')
          }))

          if (RECORD_ALL_AUDIO) {
            try {
              fsp.appendFile(audioTo11lFileName, msg, 'binary')
            } catch (error) {
              console.log("error writing to file", audioTo11lFileName, error)
            }
          }
        }
      }
    })

    ws.on('close', async () => {
      wsVgOpen = false
      console.log("\n>>> Vonage WebSocket closed")
      elevenLabsWs.close() // close WebSocket to ElevenLabs
    })
  } catch (e) {
    console.error("Socket error:", e)
  }
})

//--- If this application is hosted on VCR (Vonage Cloud Runtime) serverless infrastructure --------
app.get('/_/health', async (req: express.Request, res: express.Response) => {
  res.sendStatus(200)
})

// Vonage answer endpoint that initiates a websocket connection of an incoming phone call to the internal websocket server at /socket
// /socket endpoint will then on connection of the incoming audio stream connect to elevenlabs
app.get('/answer', async (req: express.Request, res: express.Response) => {
  try {
    console.log("CALL INCOMING: ", req.query)
    const host = req.get('host')
    const { from, to, conversation_uuid, endpoint_type, uuid, region_url } = req.query
    const vccSession = req.query['SipHeader_X-Vgai-Session-ID'] || 'unknown'
    let ncco = [
      {
        action: 'connect',
        from: 'AI_Gateway',
        endpoint: [{
          type: 'websocket',
          uri: `wss://${host}/socket?${qs.stringify(req.query)}`,
          "content-type": "audio/l16;rate=16000",
          headers: { "X-Vcc-Session": vccSession, "X-From": from, "X-To": to, "X-Conversation-Uuid": conversation_uuid, "X-Endpoint-Type": endpoint_type, "X-Uuid": uuid, "X-Region-Url": region_url }
        }]
      }]

    // We could technically connect directly to elevenlabs websocket here, 
    // but we are not doing this because we want to be able to manage the call if elevenlabs agents request a transfer
    if (process.env.USE_ELEVENLABS_WS_DIRECTLY == "true") {
      const { signedUrl } = await elevenlabsClient.conversationalAi.conversations.getSignedUrl({
        agentId: ELEVENLABS_AGENT_ID as string,
        includeConversationId: true,
      });
      const { conversation_id } = qs.parse(signedUrl)
      console.log("Signed URL:", signedUrl)
      console.log("Precreated conversation ID:", conversation_id)

      ncco = [
        {
          action: 'connect',
          from: `${from}`,
          endpoint: [{
            type: 'websocket',
            uri: `${signedUrl}`,
            "content-type": "audio/l16;rate=16000",
            headers: { "X-Vcc-Session": vccSession, "X-From": from, "X-To": to, "X-Conversation-Uuid": conversation_uuid, "X-Endpoint-Type": endpoint_type, "X-Uuid": uuid, "X-Region-Url": region_url }
          }]
        }
      ]

    }

    console.log("Connecting to websocket server locally...")
    res.json(ncco)
  } catch (e) {
    console.error("Error occurred while processing Vonage /answer request:", e)
    res.sendStatus(500)
  }
})

// Vonage call events webhook with call status, just for logging purposes
app.get('/events', (req, res) => {
  console.log("Received Vonage Webhook event: ", req.query)
  res.sendStatus(200)
})

// This endpoint is called by an elevenlabs tool when the elevenlabs agent wants to transfer the call to a VCC lnading number
// We have to do this, because elevenlabs is currently not able to properly transfer calls via PSTN or SIP for some reason
app.post('/transferCallBack', async (req, res) => {
  try {
    console.log("Transfer callback event received:\n", req.body)
    const { callerId, conversationId, transferTarget } = req.body
    console.log("Original Elevenlabs Caller ID:", callerId)
    const vonageConversation = conversations[conversationId]
    const vonageCallUuid = JSON.parse(vonageConversation).uuid || ""
    // transfer call with PUT to target
    const putUrl = "https://api.nexmo.com/v1/calls/" + vonageCallUuid
    console.log("Transferring call to:", transferTarget)
    console.log("PUT URL:", putUrl)
    const response = await axios.put(putUrl, {
      "action": "transfer",
      "destination": {
        "type": "ncco",
        "ncco": [
          {
            "action": "connect",
            "randomFromNumber": true,
            "endpoint": [
              {
                "type": "phone",
                "number": transferTarget
              }
            ]
          }
        ]

      }
    }, {
      headers: {
        "Authorization": `Bearer ${tokenGenerate(process.env.VONAGE_APP_ID as string, Buffer.from(process.env.VONAGE_PKEY_B64 as string, 'base64'), { exp: Math.floor(Date.now() / 1000) + 3600 })}`
      }
    }).catch((e) => {
      console.error("Error occurred while transferring call:", e.response.data)
      throw e
    })
    res.sendStatus(200)
  } catch (e) {
    console.error("Error occurred while processing transfer callback:", e)
    res.sendStatus(500)
  }
})

const tunnel = await localtunnel({ port: PORT as number, subdomain: process.env.LOCALTUNNEL_SUBDOMAIN || process.env.VONAGE_APP_ID });
tunnel.on('close', () => {
  console.warn("Localtunnel closed.")
});

app.listen(PORT, () => console.log(`Connector application listening on: ${tunnel.url}`))
