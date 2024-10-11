// import mime from 'mime';

// import { Slack } from './types';

// export default class SlackFileUploader {
//   constructor(private file_path: string) {}

//   upload(): Promise<Slack.FileMessage> {}

//   _getLocalFile(): Promise<string> {
//     const self = this;
//     // Download file if remote
//     if (self._file_path.startsWith('http')) {
//       const parsed = url.parse(self._file_path);
//       const filename = path.basename(parsed.pathname) || uuidv4();
//       let dest;
//       if (self._file_path.startsWith(sails.config.parameters.apiUrl)) {
//         const attachmentId = path.basename(path.dirname(parsed.pathname));
//         return Attachment.findOne({ id: attachmentId, name: filename })
//           .then((attachment) => {
//             dest = path.join(
//               sails.config.appPath,
//               sails.config.parameters.uploadDir,
//               attachment.location,
//             );
//             return dest;
//           })
//           .catch((err: Error) => {
//             sails.log.error(
//               'Slack Channel Handler : Error finding the attachment in the database',
//               err,
//             );
//             throw err;
//           });
//       } else {
//         dest = path.join(sails.config.parameters.tmpDir, filename);
//         if (fs.existsSync(dest)) {
//           sails.log.debug('Slack File Upload : Serving local file');
//           return Promise.resolve(dest);
//         } else {
//           return self._download(this._file_path, dest);
//         }
//       }
//     }
//     // If param is local path
//     return Promise.resolve(self._file_path);
//   }

//   /**
//    * @method module:Channels/Slack/SlackFileUploader._download
//    * @return {String} Remote file URL
//    * @return {String} Local file path
//    * @return {Promise<String>}
//    * @description - Download remote file and return local path
//    */
//   _download(url: string, dest: string): Promise<string> {
//     sails.log.debug('Slack File Upload : downloading file');
//     return new Promise((resolve, reject) => {
//       const file = fs.createWriteStream(dest, { flags: 'wx' });

//       request(url).pipe(file);

//       file.on('error', (err) => {
//         file.close();
//         fs.unlink(dest, () => {}); // Delete temp file
//         reject(err);
//       });

//       file.on('finish', () => {
//         resolve(dest);
//       });
//     });
//   }
// }
