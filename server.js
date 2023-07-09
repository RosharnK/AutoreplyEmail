/** @format */

import express from "express";
import path from "path";
import fs from "fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

//Oauth Scopes for accessing GMAIL API
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
];

app.get("/", async (_req, res) => {
  //handleing route root
  const __filename = fileURLToPath(import.meta.url);
  const credentialsPath = path.join(
    path.dirname(__filename),
    "credentials.json"
  );

  const credentials = await fs.readFile(credentialsPath);

  //authenticating app using scopes and creddentials
  const auth = await authenticate({
    keyfilePath: credentialsPath,
    scopes: SCOPES,
  });
  console.log("This is auth =", auth);

  const gmail = google.gmail({ version: "v1", auth });

  //defining the label name
  const labelname = "autoreply";

  //fetching list of labels
  const response = await gmail.users.labels.list({
    userId: "me",
  });

  //uploading the credentials.json file
  async function uploadCredentials() {
    const filePath = path.join(process.cwd(), "credentials.json");
    const data = await fs.readFile(filePath, { encoding: "utf8" });
    return JSON.parse(data);
  }

  //fecthing new unread emails from GMAIL
  async function newEmails(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread -from:me -has:userlabels",
    });
    return res.data.messages || [];
  }

  //sending reply to received email
  async function Reply(auth, message) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From"],
    });
    const subject = res.data.payload.headers.find(
      (header) => header.name === "Subject"
    ).value;
    const sender = res.data.payload.headers.find(
      (header) => header.name === "From"
    ).value;

    //constructing the replymsg
    const replyTo = sender.match(/<(.*)>/)[1];
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const replyBody = `Hi,\n\nI'm currently on vaccation and will get back to you soon.\n\nBest Regards,\nRoshan`;
    const rawMessage = [
      `From : me`,
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-reply-To : ${message.id}`,
      `References: ${message.id}`,
      replyBody,
    ].join("\n");
    const encodedReply = Buffer.from(rawMessage).toString("base64");

    //sending the reply email
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedReply,
      },
    });
  }

  //creating a new label
  async function newLabel(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      const res = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelname,
          labelListVisibility: "labelshow",
          messageListVisibility: "show",
        },
      });
      return res.data.id;
    } catch (err) {
      try {
        const res = await gmail.users.labels.list({
          userId: "me",
        });
        const label = res.data.labels.find((label) => label.name === labelname);
        return label.id;
      } catch (err) {
        if (err.code === 404) {
          throw new Error("The mentioned label not found");
        } else {
          throw err;
        }
      }
    }
  }

  //label to a message and remove it from the inbox
  async function pushlabel(auth, message, labelId) {
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.modify({
      userId: "me",
      id: message.id,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: ["INBOX"],
      },
    });
  }

  //intervals to check for new emails and send autoreplies
  async function main() {
    const labelId = await newLabel(auth);
    console.log(`new label found with ${labelId}`);
    const min = 45;
    const max = 120;
    setInterval(async () => {
      const messages = await newEmails(auth);
      console.log(`Found ${messages.length} unreplied messages`);

      for (const message of messages) {
        await Reply(auth, message);
        console.log(`Reply sent Successfully : ${message.id}`);

        await pushlabel(auth, message, labelId);
        console.log(`Label is successfully pushed to the id: ${message.id}`);
      }
    }, Math.floor(Math.random() * (max - min + 1) + min) * 1000);
  }
  main().catch(console.error);
});
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
