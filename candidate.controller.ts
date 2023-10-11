import { BadRequest, NotFound } from '../../errors';
import {
  CandidateService,
  InterviewStatusService,
  RejectStatusService,
} from '../../services';
import { NextFunction, Request, Response } from 'express';

import { CandidateControllerInterface } from '../../interfaces/candidate-controller-interface';
import { deleteFile } from '../../utils';
import logger from '../../helpers/logger';
import { o365_drive_file_upload } from '../../integrations/o365-storage.integrations';
import { success } from '../../helpers/api.helper';
import { Naukri, WEB_SCRAPPING } from '../../constants/global.consts';

const candidateService = new CandidateService();

export default class CandidateController
  implements CandidateControllerInterface
{
  public setCandidate: CandidateControllerInterface['setCandidate'] = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    try {
      let { candidate } = req.body;
      const interviewStatusService = new InterviewStatusService();
      const fileData = req.file!;
      candidate = JSON.parse(candidate);
      candidate.firstName = candidate.firstName.trim();
      candidate.lastName = candidate.lastName.trim();
      const existingCandidate = await candidateService.getDuplicateCandidate(
        candidate.firstName,
        candidate.lastName,
        candidate.emailId,
        candidate.jobId,
        candidate.contactNo
      );

      if (existingCandidate) {
        throw new BadRequest(
          'Candidate with the same Name,Email and Phone number already exists'
        );
      }

      const _AllStatus = await interviewStatusService.getAllInterviewStatus();
      const AllStatus = JSON.parse(JSON.stringify(_AllStatus));
      const status = AllStatus.find(
        (v: { statusCode: string }) => v.statusCode == candidate.candidateStatus
      );
      if (status == null || status == undefined) {
        throw new BadRequest('CandidateStatus Not Found');
      }
      candidate.statusId = status.id;
      const folderName =
        candidate.firstName + '_' + candidate.lastName + '_' + Date.now();

      const apiResponse = await o365_drive_file_upload(
        folderName,
        fileData,
        fileData.filename
      );
      if (apiResponse.accessUrl) {
        const uploadUrl: string = apiResponse.accessUrl;
        const fileId: string = apiResponse.id;

        const CandidateJson = candidate;
        const folderUrl = uploadUrl.slice(0, uploadUrl.lastIndexOf('/'));
        CandidateJson.fileInfo = {
          resumeUrl: uploadUrl,
          fileId: fileId,
          folderName: folderName,
        };
        CandidateJson.folderUrl = folderUrl || candidate?.folderUrl;
        CandidateJson.resumeMimeType =
          req.file?.mimetype || candidate.resumeMimeType;
        CandidateJson.resumeFileName = fileData.filename;

        candidate = await candidateService.setCandidate(candidate);
        await deleteFile(fileData);
        return success(res, { id: candidate.id }, 'Operation is successful');
      } else {
        throw new BadRequest('Resume File Not Uploaded');
      }
    } catch (err) {
      _next(err);
    }
  };

  public setCandidateFromScrapping: CandidateControllerInterface['setCandidate'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        let candidate = req.body;
        const interviewStatusService = new InterviewStatusService();
        const existingCandidate = await candidateService.getDuplicateCandidate(
          candidate.firstName,
          candidate.lastName,
          candidate.emailId,
          candidate.jobId,
          candidate.contactNo
        );
        if (existingCandidate) {
          throw new BadRequest(
            'Candidate with the same Name,Email and Phone number already exists'
          );
        }

        candidate.source = WEB_SCRAPPING;
        candidate.sourceName = Naukri;
        const _AllStatus = await interviewStatusService.getAllInterviewStatus();
        const AllStatus = JSON.parse(JSON.stringify(_AllStatus));
        const status = AllStatus.find(
          (v: { statusCode: string }) =>
            v.statusCode == candidate.candidateStatus
        );
        if (status == null || status == undefined) {
          throw new BadRequest('CandidateStatus Not Found');
        }
        candidate.statusId = status.id;

        candidate = await candidateService.setCandidate(candidate);

        return success(res, { id: candidate.id }, 'Operation is successful');
      } catch (err) {
        _next(err);
      }
    };

  public getCandidate: CandidateControllerInterface['getCandidate'] = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    try {
      const { candidateId } = req.params;
      const candidate = await candidateService.getCandidateById(
        parseInt(candidateId)
      );
      if (candidate) {
        return success(res, candidate.toJSON(), 'Operation is successful');
      }
      throw new NotFound('Candidate');
    } catch (err) {
      _next(err);
    }
  };

  public getCandidates: CandidateControllerInterface['getCandidates'] = async (
    req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    try {
      const candidates = await candidateService.getCandidates({});
      const employeeIdToFilter = req.body.employeeId;

      const userRole = res.locals.roles;

      if (!userRole.includes('TA')) {
        const filteredCandidates = candidates?.filter(
          (candidate: any) => candidate.employeeId === employeeIdToFilter
        );

        return success(res, filteredCandidates);
      }
      return success(res, candidates, 'Operation is Successful');
    } catch (err) {
      _next(err);
    }
  };

  public deleteCandidate: CandidateControllerInterface['deleteCandidate'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const { candidateId } = req.params;
        const deletedCandidate = await candidateService.deleteCandidate(
          parseInt(candidateId)
        );
        logger.info(deletedCandidate);
        if (deletedCandidate) {
          return success(
            res,
            deletedCandidate.toJSON(),
            'Candidate deleted successfully'
          );
        }
        throw new NotFound('Candidate');
      } catch (err) {
        _next(err);
      }
    };

  public updateCandidate: CandidateControllerInterface['updateCandidate'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const { candidateId } = req.params;
        const interviewStatusService = new InterviewStatusService();
        let { candidate } = req.body;
        const fileData = req.file!;
        candidate = JSON.parse(candidate);
        candidate.firstName = candidate.firstName.trim();
        candidate.lastName = candidate.lastName.trim();
        const oldCandidate = await candidateService.getCandidateById(
          parseInt(candidateId)
        );
        const oldCandidateJson = oldCandidate?.toJSON();
        if (oldCandidate == null) {
          throw new NotFound('Candidate');
        }
        if (oldCandidateJson == undefined) {
          throw new NotFound('Candidate');
        }
        if (typeof fileData !== 'undefined') {
          const folderUrlIndex: number | undefined =
            oldCandidate.folderUrl?.lastIndexOf('/');
          if (folderUrlIndex == null) {
            throw new NotFound('Resume');
          }

          const folderId: string | undefined = oldCandidate.folderUrl?.slice(
            folderUrlIndex + 1
          );

          if (folderId == null) {
            throw new NotFound('Resume');
          }

          const apiResponse = await o365_drive_file_upload(
            folderId,
            fileData,
            fileData.filename
          );
          const uploadUrl = apiResponse.accessUrl;
          const fileId = apiResponse.id;
          candidate.fileInfo = { resumeUrl: uploadUrl, fileId: fileId };
          candidate.resumeFileName = apiResponse.name;
          const folderUrl = uploadUrl.slice(0, uploadUrl.lastIndexOf('/'));
          candidate.folderUrl = folderUrl || candidate.folderUrl;
          oldCandidate.resumeMimeType = req.file!.mimetype;
        }
        const updatedCandidate = oldCandidate?.toJSON();

        const newCandidate = { ...updatedCandidate, ...candidate };

        delete candidate.id;
        logger.info(candidate);
        const _AllStatus = await interviewStatusService.getAllInterviewStatus();
        const AllStatus = JSON.parse(JSON.stringify(_AllStatus));
        const status = AllStatus.find(
          (v: { statusCode: string }) =>
            v.statusCode == candidate.candidateStatus
        );
        if (status == null || status == undefined) {
          throw new BadRequest('candidateStatus');
        }
        newCandidate.statusId = status.id;
        const result = await candidateService.updateCandidate(
          parseInt(candidateId),
          newCandidate
        );

        if (result) {
          return success(
            res,
            { id: newCandidate.id },
            'Candidate has been updated Successfully'
          );
        }
        throw new NotFound('Candidate');
      } catch (err) {
        _next(err);
      }
    };

  public updateCandidateStatus: CandidateControllerInterface['updateCandidate'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const { candidateId, screeningStatus } = req.params;
        const { rejectStatus, processData } = req.body;
        const interviewStatusService = new InterviewStatusService();
        const rejectStatusService = new RejectStatusService();
        const _AllStatus = await interviewStatusService.getAllInterviewStatus();
        const AllStatus = JSON.parse(JSON.stringify(_AllStatus));
        const status = AllStatus.find(
          (v: { statusCode: string }) => v.statusCode == screeningStatus
        );

        if (status == null || status == undefined) {
          throw new BadRequest('screeningStatus');
        }
        let RejectStatus;
        if (rejectStatus != undefined || rejectStatus != null) {
          const _AllRejectStatus =
            await rejectStatusService.getAllRejectStatus();
          const AllRejectStatus = JSON.parse(JSON.stringify(_AllRejectStatus));
          RejectStatus = AllRejectStatus.find(
            (v: { reason: string }) => v.reason == rejectStatus
          );

          if (RejectStatus == null || RejectStatus == undefined) {
            throw new BadRequest('RejectStatus');
          }
        }
        const oldCandidate = await candidateService.getCandidateById(
          parseInt(candidateId)
        );

        const oldCandidateJson: any = oldCandidate?.toJSON();

        if (oldCandidate == null) {
          throw new NotFound('Candidate');
        }

        if (oldCandidate == undefined) {
          throw new NotFound('Candidate');
        }

        oldCandidateJson.statusId = status.id;
        if (rejectStatus != undefined || rejectStatus != null) {
          oldCandidateJson.rejectReasonId = RejectStatus.id;
        }
        oldCandidateJson.processData = processData;

        const newCandidate = { ...oldCandidateJson, ...oldCandidate };

        const result = await candidateService.updateCandidate(
          parseInt(candidateId),
          newCandidate
        );

        if (result) {
          return success(
            res,
            { id: candidateId },
            'Candidate status has been updated Successfully'
          );
        }

        throw new NotFound('Candidate');
      } catch (err) {
        _next(err);
      }
    };

  public getCandidatesByInterviews: CandidateControllerInterface['getCandidatesByInterviews'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const candidates = await candidateService.getCandidatesByInterviews();
        const employeeIdToFilter = req.body.employeeId;
        const userRole = res.locals.roles;
        if (!userRole.includes('TA')) {
          const filteredCandidates: any = [];
          candidates.forEach((c: any) => {
            let flag = false;
            for (let i = 0; i < c.panelistData.length; i++) {
              if (c.panelistData[i].panelistId == employeeIdToFilter) {
                flag = true;
                break;
              }
            }
            if (flag) {
              filteredCandidates.push(c);
            }
          });

          return success(res, filteredCandidates, 'Operation is Successful');
        }
        return success(res, candidates, 'Operation is Successful');
      } catch (err) {
        _next(err);
      }
    };
  public getCandidatesForInterview: CandidateControllerInterface['getCandidatesForInterview'] =
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const _candidates = await candidateService.getCandidatesForInterview();
        const candidates = _candidates.filter((ele: any) => {
          return ele !== undefined;
        });
        return success(res, candidates, 'Operation is Successful');
      } catch (err) {
        _next(err);
      }
    };
}
