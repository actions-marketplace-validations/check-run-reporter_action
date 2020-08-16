import fs from 'fs';
import util from 'util';

import axios, {AxiosError} from 'axios';
import FormData from 'form-data';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as github from '@actions/github';

/**
 * Detmerins the value to send as "root".
 */
export function determineRoot(): string {
  core.startGroup('Determining "root" path');
  let root = core.getInput('root');
  if (!root) {
    core.info('"root" not set, trying environment variable');
    const gw = process.env.GITHUB_WORKSPACE;
    if (gw) {
      root = gw;
    }
  }
  if (!root) {
    core.info('"root" not set, trying pwd');
    root = process.cwd();
  }
  core.endGroup();
  return root;
}
/**
 * Finds all reports according to the workflow-specified glob.
 */
export async function findReports(): Promise<string[]> {
  core.startGroup('Locating files');

  const report = core.getInput('report');

  const globber = await glob.create(report);
  const files = await globber.glob();

  core.info(`found ${files.length} reports`);

  if (files.length === 0) {
    throw new Error(`Could not find any report files matching glob ${report}`);
  }

  core.endGroup();

  return files;
}

/**
 * Main entrypoint
 */
async function main() {
  // For lack of a better pattern, we'll default to the same pattern that GitHub
  // uses for checks at the bottom of the PR.
  const label =
    core.getInput('label') ||
    `${github.context.workflow} / ${github.context.job}`;

  const token = core.getInput('token');
  const url = core.getInput('url');

  const root = determineRoot();
  const files = await findReports();

  const {sha} = github.context;

  const formData = new FormData();
  for (const file of files) {
    formData.append('report', fs.createReadStream(file));
  }

  formData.append('label', label);
  formData.append('root', root);
  formData.append('sha', sha);

  core.startGroup('Uploading report to Check Run Reporter');
  try {
    await axios.post(url, formData, {
      auth: {password: token, username: 'token'},
      headers: {
        ...formData.getHeaders(),
      },
    });
  } catch (err) {
    if (!(err as AxiosError).isAxiosError) {
      throw err;
    }

    const axerr = err as AxiosError;

    if (!axerr.response) {
      // we didn't get a response, let the unhandled error error handler deal
      // with it
      core.error('Failed to make upload request');
      throw err;
    }

    core.error(`Request ID: ${axerr.response.headers['x-request-id']}`);
    core.error(util.inspect(axerr.response.data, {depth: 2}));
    core.setFailed(axerr.message);
  }
  core.endGroup();
}

if (require.main === module) {
  main().catch((err) => {
    core.error(err.stack);
    core.setFailed(err.message);
  });
}