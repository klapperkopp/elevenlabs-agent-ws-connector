# Vonage Voice x Elevenlabs AI Connector for Websocket audio

This server connects Vonage Voice API callers (phone, sip, app) to ElevenLabs Agents for real-time voice communication. This is a sample application not intended for production use. Please apply security best practices when deploying.

# Pre-Requisites
1. You need a [Vonage API Account](https://dashboard.vonage.com)
   - [Create a new Vonage Application](https://dashboard.vonage.com/applications/new)
     - Generated public key and private.key file
     - Voice + RTC enabled
     - Answer Url: https://<this_servers_url>/answer
     - Event Url: https://<this_servers_url>/events
   - [Buy a voice enabled phone number](https://dashboard.vonage.com/numbers/buy-numbers) and link it to the previously created application in your [application settings](https://dashboard.vonage.com/applications)
2. You need an [Elevenlabs Account](https://elevenlabs.io/)
3. Localtunnel, ngrok or similar for local development, to expose your server to the internet
   - Localtunnel comes with the project and will be setup automatically to use your application ID as the public url of your server. So for example your domain will be https://<your_vonage_app_id>.loca.lt
   - You can set .env variable *LOCALTUNNEL_SUBDOMAIN* to any alphanumeric value to set your own <LOCALTUNNEL_SUBDOMAIN>.loca.lt address. This is based on availability, so use a unique string that might not be taken already if you set this.

# Local Setup & Run

1. `cp .env.example .env` and fill in all variables
   - *ELEVENLABS_API_KEY:* Create and copy from the [Developer settings](https://elevenlabs.io/app/developers/api-keys)
   - *ELEVENLABS_AGENT_ID:* Copy from your [agent settings](https://elevenlabs.io/app/agents)
   - *ELEVENLABS_VOICE_ID:* Copy from your [Workspace](https://elevenlabs.io/app/agents/voice-lab) or Agent Voice settings, default: aTTiK3YzK3dXETpuDE2h (Ben, German)
   - *RECORD_ALL_AUDIO:* Saves audio streams to local recordings, default: false
   - *VONAGE_APP_ID:* Copy after creating the [application](https://dashboard.vonage.com/applications), according to Pre-Requisites
   - *VONAGE_PKEY_B64:* When you created the Vonage application and clicked to generate public and private key, it will download a private.key file to your computer. Use base64encode.org to encode the file contents and paste the base64 encoded string into this variable.
   - *USE_ELEVENLABS_WS_DIRECTLY:* Currently not functional if set to true, due to elevenlabs incompatibilities, default: false
   - *LOCALTUNNEL_SUBDOMAIN:* Subdomain for your server url, optional (default server url will be automatically https://<your_vonage_app_id>.loca.lt)
2. Run `npm i`
3. Run `npm start`
4. Call your Vonage phone number and you will be connected to the elevenlabs agent

# Elevenlabs Call Transfer Setup via Tool Call

1. Go to [Tools section](https://elevenlabs.io/app/agents/tools)
2. Create a new webhook tool
   - Method: POST
   - Url: https://<your_subdomain.loca.lt>/transferCallBack
   - Body Parameters:
     - *transferType:* (String, Constant, required) - "phone" or "sip" depending on how you want to forward the call. Please note that this affects the transferTarget parameter. If you use "phone" then transferTarget has to be an E.164 format phone number, ifyou use "sip", it must be a valid sip uri.
     - *transferTarget:* (String, Constant, required) - Set this to the phone number you want to redirect to
     - *conversationId:* (String, Dynamic Variable, required) - Set this to system__conversation_id
     - *callerId:* (String, Dynamic Variable, optional) - Set this to system__caller_id (currently not working for cetrain call types, due to elevenlabs deficiencies)
     - *SipHeader_XXX:* (String, Constan or Dynamic, optional) - You can define as many SIP Headers to be added, if the transfer target is a SIP url. Just Call them SipHeader_<name> e.g. SipHeader_OriginalCaller. All Variables starting with "SipHeader_" will be added to "sip" forwards.
3. Use the tool in your agent if you want to trasnfer the call over to the *transferTarget* number (e.g. for human escalation)

# Other Useful Information:
- When forwarding an incoming Vonage Contact Center (VCC) SIP call via Vonage Voice API to Elevenlabs, we are automatically adding the following important headers to the elevenlabs conversation as parameters (visible in the agent conversation view in elevenlabs under the 'client data' tab.)
  - vapi_conversation_id - the Vonage Voice API Conversation ID (of the incoming call that is forwarded to elevenlabs)
  - vapi_call_uuid  - the Vonage Voice API Call ID (of the incoming call that is forwarded to elevenlabs)
  - vapi_from - the Vonage Voice API Inbound caller ID (this would be the VCC number in the case of VCC forwarding to the voice APi number)
  - vapi_to - the Vonage Voice API called virtual number (used by VCC for the forward)
  - vapi_endpoint_type - the Vonage Voice API inbound call endpoint (can be phone, sip, webocket or app)
  - vapi_region_url - the Vonage Voice API regions server url used for the call (e.g. EU)
  - vcc_sip_call_guid - The original Call ID of the users inbound call on VCC side
  - vcc_sip_caller_id - The original Caller ID of the user calling the contact center.
  - vcc_sip_session_id -  The original SIP Session ID from VCC side
- All of the above headers are also autoamtically passed thorugh to Vonage Contact Center in the case of a "sip" transfer too call. We are storing them in temporarily in RAM and passing them on if the tool call for transfer happens. To actually being able to receive these headers on VCC side, pelase make sure to whitelist them, with the names from above.


# Questions?
Feel free to reach out to toni.kuschan at vonage.com.