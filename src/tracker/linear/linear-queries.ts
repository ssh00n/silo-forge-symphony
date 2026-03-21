/**
 * GraphQL queries for the Linear issue tracker.
 */

export const CANDIDATE_ISSUES_QUERY = `
query CandidateIssues($projectSlug: String!, $stateNames: [String!]!, $after: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $stateNames } }
    }
    first: 50
    after: $after
    orderBy: createdAt
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      title
      description
      priority
      branchName
      url
      createdAt
      updatedAt
      state {
        name
      }
      labels {
        nodes {
          name
        }
      }
      inverseRelations {
        nodes {
          type
          issue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
    }
  }
}
`;

export const ISSUES_BY_STATES_QUERY = `
query IssuesByStates($projectSlug: String!, $stateNames: [String!]!, $after: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $stateNames } }
    }
    first: 50
    after: $after
    orderBy: createdAt
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      state {
        name
      }
    }
  }
}
`;

export const ISSUE_STATES_BY_IDS_QUERY = `
query IssueStatesByIds($issueIds: [ID!]!) {
  issues(filter: { id: { in: $issueIds } }) {
    nodes {
      id
      identifier
      title
      description
      priority
      branchName
      url
      createdAt
      updatedAt
      state {
        name
      }
      labels {
        nodes {
          name
        }
      }
      inverseRelations {
        nodes {
          type
          issue {
            id
            identifier
            state {
              name
            }
          }
        }
      }
    }
  }
}
`;
