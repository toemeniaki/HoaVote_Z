pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HoaVote_Z is ZamaEthereumConfig {
    
    struct Proposal {
        string title;
        euint32 encryptedWeight;
        uint256 publicOption1;
        uint256 publicOption2;
        address creator;
        uint256 timestamp;
        uint32 decryptedWeight;
        bool isVerified;
    }

    struct Vote {
        string proposalId;
        euint32 encryptedVote;
        address voter;
        uint256 timestamp;
        uint32 decryptedVote;
        bool isVerified;
    }
    
    mapping(string => Proposal) public proposals;
    mapping(string => Vote) public votes;
    string[] public proposalIds;
    string[] public voteIds;

    event ProposalCreated(string indexed proposalId, address indexed creator);
    event VoteCast(string indexed voteId, address indexed voter);
    event ProposalDecrypted(string indexed proposalId, uint32 decryptedWeight);
    event VoteDecrypted(string indexed voteId, uint32 decryptedVote);

    constructor() ZamaEthereumConfig() {
    }

    function createProposal(
        string calldata proposalId,
        string calldata title,
        externalEuint32 encryptedWeight,
        bytes calldata inputProof,
        uint256 publicOption1,
        uint256 publicOption2
    ) external {
        require(bytes(proposals[proposalId].title).length == 0, "Proposal already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedWeight, inputProof)), "Invalid encrypted input");

        proposals[proposalId] = Proposal({
            title: title,
            encryptedWeight: FHE.fromExternal(encryptedWeight, inputProof),
            publicOption1: publicOption1,
            publicOption2: publicOption2,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedWeight: 0,
            isVerified: false
        });

        FHE.allowThis(proposals[proposalId].encryptedWeight);
        FHE.makePubliclyDecryptable(proposals[proposalId].encryptedWeight);
        proposalIds.push(proposalId);
        emit ProposalCreated(proposalId, msg.sender);
    }

    function castVote(
        string calldata voteId,
        string calldata proposalId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(bytes(votes[voteId].proposalId).length == 0, "Vote already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted input");

        votes[voteId] = Vote({
            proposalId: proposalId,
            encryptedVote: FHE.fromExternal(encryptedVote, inputProof),
            voter: msg.sender,
            timestamp: block.timestamp,
            decryptedVote: 0,
            isVerified: false
        });

        FHE.allowThis(votes[voteId].encryptedVote);
        FHE.makePubliclyDecryptable(votes[voteId].encryptedVote);
        voteIds.push(voteId);
        emit VoteCast(voteId, msg.sender);
    }

    function verifyProposalDecryption(
        string calldata proposalId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(!proposals[proposalId].isVerified, "Proposal already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(proposals[proposalId].encryptedWeight);
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        proposals[proposalId].decryptedWeight = decodedValue;
        proposals[proposalId].isVerified = true;
        emit ProposalDecrypted(proposalId, decodedValue);
    }

    function verifyVoteDecryption(
        string calldata voteId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(votes[voteId].proposalId).length > 0, "Vote does not exist");
        require(!votes[voteId].isVerified, "Vote already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(votes[voteId].encryptedVote);
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        votes[voteId].decryptedVote = decodedValue;
        votes[voteId].isVerified = true;
        emit VoteDecrypted(voteId, decodedValue);
    }

    function getProposal(string calldata proposalId) external view returns (
        string memory title,
        uint256 publicOption1,
        uint256 publicOption2,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedWeight
    ) {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        Proposal storage p = proposals[proposalId];
        return (p.title, p.publicOption1, p.publicOption2, p.creator, p.timestamp, p.isVerified, p.decryptedWeight);
    }

    function getVote(string calldata voteId) external view returns (
        string memory proposalId,
        address voter,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedVote
    ) {
        require(bytes(votes[voteId].proposalId).length > 0, "Vote does not exist");
        Vote storage v = votes[voteId];
        return (v.proposalId, v.voter, v.timestamp, v.isVerified, v.decryptedVote);
    }

    function getAllProposalIds() external view returns (string[] memory) {
        return proposalIds;
    }

    function getAllVoteIds() external view returns (string[] memory) {
        return voteIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


